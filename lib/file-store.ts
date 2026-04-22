import fs from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");

export async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  await ensureDataDir();
  const fullPath = path.join(dataDir, fileName);

  try {
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

export async function writeJsonFile<T>(fileName: string, value: T) {
  await ensureDataDir();
  const fullPath = path.join(dataDir, fileName);
  await fs.writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function updateJsonFile<T>(
  fileName: string,
  fallback: T,
  updater: (current: T) => T,
) {
  const current = await readJsonFile(fileName, fallback);
  const next = updater(current);
  await writeJsonFile(fileName, next);
  return next;
}

export async function fileExists(fileName: string) {
  await ensureDataDir();
  const fullPath = path.join(dataDir, fileName);

  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}
