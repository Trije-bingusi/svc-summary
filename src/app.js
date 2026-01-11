import express from "express";
import client from "prom-client";
import YAML from "yamljs";
import { PrismaClient } from "@prisma/client";
import { apiReference } from "@scalar/express-api-reference";
import { logger, httpLogger } from "./logging.js";
import { subscribeJson } from "./mq.js";

import { PORT, DATABASE_URL } from "./config.js";
import { generateSummary } from "./summary.js";


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

// Saves generated summary to the database
async function saveSummary(lectureId, summaryText) {
  await prisma.summary.create({
    data: {
      lecture_id: lectureId,
      summary_text: summaryText,
    },
  });
}

/**
 * Fetches and retrieves transcription text from a given JSON URL. The 
 * JSON is expected to be an array of objects with a 'text' field. These
 * text fields are concatenated into a single transcription string.
 * @param {string} jsonUrl 
 */
async function retrieveJsonTranscription(jsonUrl) {
  const response = await fetch(jsonUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch transcription JSON: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const lines = data.map(entry => entry.text);
  return lines.join("\n");  
}

// Starts generation of summary for a given lecture transcription
app.post("/api/lectures/:lectureId/summary", async (req, res) => {
  const { lectureId } = req.params;
  let { transcription, transcriptionJsonUrl } = req.body;

  if (!transcription && !transcriptionJsonUrl) {
    return res.status(400).json({ error: "Missing transcription or transcriptionJsonUrl in request body" });
  }

  setImmediate(async () => {
    try {
      if (!transcription) {
        req.log.info(`Fetching transcription JSON from ${transcriptionJsonUrl}`);
        transcription = await retrieveJsonTranscription(transcriptionJsonUrl);
      }

      logger.info(`Generating summary for lecture ${lectureId}`);
      const summaryText = await generateSummary(transcription);
      logger.info(`Saving summary for lecture ${lectureId}`);
      await saveSummary(lectureId, summaryText);
    } catch (error) {
      logger.error(error, `Failed to generate or save summary for lecture ${lectureId}`);
    }
  });
  res.status(202).json({ message: "Summary generation started" });
});

// Generate summary automatically when transcription is completed (via NATS message)
subscribeJson("transcriptions.completed", async (data) => {
  try {
    const lectureId = data.lecture_id;
    const transcriptionJsonUrl = data.transcription_json_url;
    logger.info(`Received transcription completed message for lecture ${lectureId}`);

    const transcription = await retrieveJsonTranscription(transcriptionJsonUrl);
    const summaryText = await generateSummary(transcription);
    await saveSummary(lectureId, summaryText);
    logger.info(`Summary generated and saved for lecture ${lectureId}`);
  } catch (error) {
    logger.error(error, `Failed to generate or save summary for lecture ${lectureId}`);
  }
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
