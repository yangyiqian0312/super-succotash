import { hasDatabase, sql } from "@/lib/db";
import { readJsonFile, updateJsonFile } from "@/lib/file-store";

const FILE_NAME = "processed-webhooks.json";
const MAX_KEYS = 1000;

type ProcessedWebhookState = {
  keys: string[];
};

const fallbackState: ProcessedWebhookState = {
  keys: [],
};

export async function hasProcessedWebhook(key: string) {
  if (hasDatabase) {
    const rows = await sql<{ key: string }>`
      SELECT key FROM processed_webhooks WHERE key = ${key} LIMIT 1
    `;
    return rows.length > 0;
  }

  const state = await readJsonFile<ProcessedWebhookState>(FILE_NAME, fallbackState);
  return state.keys.includes(key);
}

export async function markWebhookProcessed(key: string) {
  if (hasDatabase) {
    await sql`
      INSERT INTO processed_webhooks (key, created_at)
      VALUES (${key}, NOW())
      ON CONFLICT (key) DO NOTHING
    `;
    await sql`
      DELETE FROM processed_webhooks
      WHERE key IN (
        SELECT key FROM processed_webhooks
        ORDER BY created_at DESC
        OFFSET ${MAX_KEYS}
      )
    `;
    return;
  }

  await updateJsonFile<ProcessedWebhookState>(FILE_NAME, fallbackState, (current) => {
    const nextKeys = [...current.keys, key];
    return {
      keys: nextKeys.slice(-MAX_KEYS),
    };
  });
}
