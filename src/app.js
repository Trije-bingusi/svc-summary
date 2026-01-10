import express from "express";
import client from "prom-client";
import YAML from "yamljs";
import { PrismaClient } from "@prisma/client";
import { apiReference } from "@scalar/express-api-reference";
import { logger, httpLogger } from "./logging.js";

function env(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    if (fallback === undefined) {
      throw new Error(`Missing env: ${name}`);
    }
    return fallback;
  }
  return raw;
}

const PORT = Number(env("PORT", "3000"));
const DATABASE_URL = env(
  "DATABASE_URL",
  "postgres://postgres:postgres@localhost:5432/summary"
);

const HUGGINGFACE_TOKEN = env("HUGGINGFACE_TOKEN");
const HUGGINGFACE_MODEL = env("HUGGINGFACE_MODEL", "openai/gpt-oss-120b");
const HUGGINGFACE_API_URL = env("HUGGINGFACE_API_URL", "https://router.huggingface.co/v1/chat/completions");

const SUMMARIZATION_PROMPT = (
   "You are a helpful assistant that creates a description for lectures in " +
   "arbitrary languages. The output language should match the input. The " +
   "description should be concise, with only a few sentences."
)

const prisma = new PrismaClient();

const app = express();
app.use(express.json());
app.use(httpLogger);

// Scalar API reference
const openapi = YAML.load("./openapi.yaml");
app.get("/docs/summary/openapi.json", (_req, res) => res.json(openapi));
app.use(
  "/docs/summary",
  apiReference({
    url: "/docs/summary/openapi.json",
    theme: "default",
    darkMode: true,
  })
);

// Prometheus metrics
client.collectDefaultMetrics();
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// Health endpoints
app.get("/healthz", (_req, res) => res.send("OK"));
app.get("/readyz", async (_req, res) => {
  try {
    // Simple connectivity check to the DB
    await prisma.$queryRaw`SELECT 1`;
    res.send("READY");
  } catch {
    res.status(500).send("NOT READY");
  }
});

// Retrieve summary for a given lecture
app.get("/api/lectures/:lectureId/summary", async (req, res) => {
  const { lectureId } = req.params;
  try {
    const summaryQuery = await prisma.summary.findFirst({
      where: { lecture_id: lectureId },
      orderBy: { timestamp: "desc" },
      select: { summary_text: true },
    });

    if (!summaryQuery) {
      return res.status(404).json({ error: "Summary not found" });
    }

    res.json({ summary: summaryQuery.summary_text });

  }  catch (error) {
    req.log.error(error, "Failed to fetch summary");
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

async function generateSummary(transcription) {
  const response = await fetch(HUGGINGFACE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${HUGGINGFACE_TOKEN}`,
    },
    body: JSON.stringify({
      model: HUGGINGFACE_MODEL,
      messages: [
        {
          role: "system",
          content: SUMMARIZATION_PROMPT
        },
        {
          role: "user",
          content: transcription
        }
      ]
    }),
  })

  if (!response.ok) {
    logger.error(`Hugging Face API error: ${response.status} ${response.statusText}`);
    throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const summary = data.choices[0].message.content;
  return summary;
}

async function saveSummary(lectureId, summaryText) {
  await prisma.summary.create({
    data: {
      lecture_id: lectureId,
      summary_text: summaryText,
    },
  });
}

async function generateAndSaveSummary(lectureId, transcription) {
  try {
    const summaryText = await generateSummary(transcription);
    await saveSummary(lectureId, summaryText);
  } catch (error) {
    logger.error(error, `Failed to generate or save summary for lecture ${lectureId}`);
  }
}

// Starts generation of summary for a given lecture transcription
app.post("/api/lectures/:lectureId/summary", async (req, res) => {
  const { lectureId } = req.params;
  const { transcription } = req.body;

  if (!transcription) {
    return res.status(400).json({ error: "Missing transcription in request body" });
  }

  logger.info(`Generating summary for lecture ${lectureId}`);
  setImmediate(async () => await generateAndSaveSummary(lectureId, transcription));
  res.status(202).json({ message: "Summary generation started" });
});

// Error handling
app.use((err, _req, res, _next) => {
  logger.error(err, `Internal server error: ${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

// Start + graceful shutdown
const server = app.listen(PORT, () => {
  logger.info("Summary service listening on port", PORT);
});

function shutdown() {
  logger.info("Shutting down server...");
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
