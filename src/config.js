function env(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    if (fallback === undefined) throw new Error(`Missing env: ${name}`);
    return fallback;
  }
  return raw;
}

export const PORT = Number(env("PORT", "3000"));
export const DATABASE_URL = env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/summary");
export const HUGGINGFACE_TOKEN = env("HUGGINGFACE_TOKEN");
export const HUGGINGFACE_MODEL = env("HUGGINGFACE_MODEL", "openai/gpt-oss-120b");
export const HUGGINGFACE_API_URL = env("HUGGINGFACE_API_URL", "https://router.huggingface.co/v1/chat/completions");
export const NATS_URL = env("NATS_URL", "");
