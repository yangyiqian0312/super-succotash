type LogPayload = Record<string, unknown> | unknown;

function write(level: "INFO" | "ERROR" | "WARN", event: string, payload?: LogPayload) {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level}] ${event}`;

  if (payload === undefined) {
    console.log(base);
    return;
  }

  console.log(base, JSON.stringify(payload));
}

export const logger = {
  info(event: string, payload?: LogPayload) {
    write("INFO", event, payload);
  },
  warn(event: string, payload?: LogPayload) {
    write("WARN", event, payload);
  },
  error(event: string, payload?: LogPayload) {
    write("ERROR", event, payload);
  },
};
