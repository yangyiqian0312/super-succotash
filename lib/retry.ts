import { logger } from "@/lib/logger";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 500,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      logger.info("retry.attempt", { label, attempt, retries });
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn("retry.failed_attempt", {
        label,
        attempt,
        retries,
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt < retries) {
        await sleep(delayMs * attempt);
      }
    }
  }

  throw lastError;
}
