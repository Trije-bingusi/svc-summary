import { logger } from "./logging.js";
import { HUGGINGFACE_TOKEN, HUGGINGFACE_MODEL, HUGGINGFACE_API_URL } from "./config.js";


const SUMMARIZATION_PROMPT = (
   "You are a helpful assistant that creates a description for lectures in " +
   "arbitrary languages. The output language should match the input. The " +
   "description should be concise, with only a few sentences."
);

export async function generateSummary(transcription) {
  const response = await fetch(HUGGINGFACE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${HUGGINGFACE_TOKEN}`,
    },
    body: JSON.stringify({
      model: HUGGINGFACE_MODEL,
      messages: [
        { role: "system", content: SUMMARIZATION_PROMPT },
        { role: "user", content: transcription }
      ]
    }),
  });

  if (!response.ok) {
    logger.error(`Hugging Face API error: ${response.status} ${response.statusText}`);
    throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const summary = data.choices[0].message.content;
  return summary;
}
