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
  const state = await readJsonFile<ProcessedWebhookState>(FILE_NAME, fallbackState);
  return state.keys.includes(key);
}

export async function markWebhookProcessed(key: string) {
  await updateJsonFile<ProcessedWebhookState>(FILE_NAME, fallbackState, (current) => {
    const nextKeys = [...current.keys, key];
    return {
      keys: nextKeys.slice(-MAX_KEYS),
    };
  });
}
