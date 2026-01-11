import { connect, JSONCodec } from "nats";
import { logger } from "./logging.js";
import { NATS_URL } from "./config.js";


const jc = JSONCodec();
let nc = null;
try {
  if (!NATS_URL) throw new Error("NATS_URL is not defined");
  nc = await connect({ servers: NATS_URL });
  logger.info("Connected to NATS successfully");
} catch (err) {
  logger.warn(`Failed to connect to NATS: ${err.message}`);
}

export async function publishJson(subject, data) {
  if (!nc) {
    logger.warn("NATS connection not established, cannot publish message");
    return;
  }

  nc.publish(subject, jc.encode(data));
}


export async function subscribeJson(subject, handler) {
  if (!nc) {
    logger.warn("NATS connection not established, cannot subscribe to messages");
    return;
  }

  const sub = nc.subscribe(subject);
  (async () => {
    for await (const msg of sub) {
      const data = jc.decode(msg.data);
      try {
        await handler(data);
      } catch (err) {
        logger.error(`Error handling message on subject ${subject}: ${err.message}`);
      }
    }
  })();
  logger.info(`Subscribed to NATS subject: ${subject}`);
}
