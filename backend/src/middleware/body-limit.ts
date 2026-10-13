import { bodyLimit } from "hono/body-limit";

/**
 * Public routes (/api/pair/start, /api/pair/check, /api/auth/login-qr): an anonymous caller must not make the
 * Worker buffer and parse a large body. Nothing legitimate is anywhere near this (the largest body is ~150 bytes).
 */
export const publicBodyLimit = bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) });
