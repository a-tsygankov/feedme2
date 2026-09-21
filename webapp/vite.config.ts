import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

/**
 * Emits /version.json = {"webapp": "<package.json version>"} into the
 * build. The running app polls it (src/lib/pwa-update-browser.ts) to
 * learn a newer build was deployed, because browsers only check for a
 * new service worker on navigation or roughly daily. Excluded from the
 * precache by the glob below — a precached version file would always
 * agree with the bundle that precached it.
 */
function versionJson(): Plugin {
  return {
    name: "feedme2-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ webapp: pkg.version }),
      });
    },
  };
}

export default defineConfig({
  // `@/` mirrors tsconfig.app.json paths; shadcn components import
  // `@/lib/utils` verbatim, so the alias must exist in every resolver.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    react(),
    versionJson(),
    VitePWA({
      // "prompt": the app offers an update bar rather than reloading
      // under someone mid-entry.
      registerType: "prompt",
      // Registration lives in src/lib/pwa-update-browser.ts, which also
      // needs the registration object to poll for updates.
      injectRegister: null,
      // injectManifest: src/sw.ts is ours (push handlers later), so
      // precaching is our responsibility too — see sw.ts.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
      },
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/favicon-16.png"],
      manifest: {
        name: "feedme2",
        short_name: "feedme2",
        description: "Household cat-feeding tracker",
        // Must match index.html's <meta name="theme-color">.
        theme_color: "#f8fafc",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  // `vite preview` serves the build WITH the real service worker — the
  // only way to exercise offline reopen locally.
  preview: {
    proxy: { "/api": { target: process.env["VITE_WORKER_ORIGIN"] ?? "http://127.0.0.1:8787", changeOrigin: true } },
  },
  server: {
    proxy: { "/api": { target: process.env["VITE_WORKER_ORIGIN"] ?? "http://127.0.0.1:8787", changeOrigin: true } },
  },
});
