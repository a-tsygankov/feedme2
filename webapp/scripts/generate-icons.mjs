#!/usr/bin/env node
/**
 * Generate the PWA icon set into public/icons/ (committed — CI never
 * runs this). Rerun after changing the mark:
 *
 *     node scripts/generate-icons.mjs
 *
 * The mark is pure SVG shapes (no <text> — font rendering inside
 * librsvg is unreliable across platforms): an emerald tile with a
 * white cat-silhouette (round head + two ears) placeholder.
 *
 * Variants:
 *   any       — rounded-corner tile (matches the app's 12px radius feel)
 *   maskable  — square full-bleed tile, mark shrunk into the 80% safe
 *               zone (the OS applies its own circle/squircle mask)
 *   apple     — square 180px (iOS rounds it itself)
 *   favicon   — 32/16 rounded tiles
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const EMERALD = "#059669"; // emerald-600 — the app accent

function markSvg(size, { rounded, safe }) {
  const rx = rounded ? Math.round(size * 0.15) : 0;
  const scale = safe ? 0.8 : 1;
  const c = size / 2;
  const r = size * 0.24 * scale;          // head
  const ear = size * 0.16 * scale;        // ear height
  const earHalf = size * 0.11 * scale;    // ear half-width
  const headTop = c - r * 0.55;
  const leftEar = `${c - r * 0.75},${headTop} ${c - r * 0.75 - earHalf * 0.4},${headTop - ear} ${c - r * 0.75 + earHalf},${headTop + earHalf * 0.5}`;
  const rightEar = `${c + r * 0.75},${headTop} ${c + r * 0.75 + earHalf * 0.4},${headTop - ear} ${c + r * 0.75 - earHalf},${headTop + earHalf * 0.5}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="${EMERALD}"/>
  <polygon points="${leftEar}" fill="#ffffff"/>
  <polygon points="${rightEar}" fill="#ffffff"/>
  <circle cx="${c}" cy="${c + r * 0.15}" r="${r}" fill="#ffffff"/>
</svg>`;
}

async function render(name, size, options) {
  await sharp(Buffer.from(markSvg(size, options)))
    .png()
    .toFile(fileURLToPath(new URL(`../public/icons/${name}`, import.meta.url)));
  console.log(`  icons/${name}`);
}

await mkdir(new URL("../public/icons/", import.meta.url), { recursive: true });

await render("icon-192.png", 192, { rounded: true, safe: false });
await render("icon-512.png", 512, { rounded: true, safe: false });
await render("icon-192-maskable.png", 192, { rounded: false, safe: true });
await render("icon-512-maskable.png", 512, { rounded: false, safe: true });
await render("apple-touch-icon.png", 180, { rounded: false, safe: false });
await render("favicon-32.png", 32, { rounded: true, safe: false });
await render("favicon-16.png", 16, { rounded: true, safe: false });

console.log("done");
