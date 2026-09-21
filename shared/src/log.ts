import { z } from "zod";

/**
 * One log line, the same shape for web, worker and device so the
 * hidden console renders all three in one list (spec §4.6).
 */
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export const LogSourceSchema = z.enum(["web", "worker", "device"]);

export const LogEntrySchema = z.object({
  /** epoch ms */
  ts: z.number().int(),
  level: LogLevelSchema,
  source: LogSourceSchema,
  msg: z.string().max(500),
  data: z.record(z.unknown()).optional(),
  deviceId: z.string().max(64).optional(),
  clientId: z.string().max(64).optional(),
});

export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogSource = z.infer<typeof LogSourceSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
