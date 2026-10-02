import { defineConfig, loadEnv } from "vite";
import fs from "node:fs";
import { patternSavePlugin } from "./scripts/pattern-save-plugin.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vercel sets VERCEL_PROJECT_PRODUCTION_URL (without protocol) at build time.
// Propagate it as VITE_SITE_URL so index.html's %VITE_SITE_URL% substitutions
// resolve to the real canonical URL on production builds. The .env.production
// fallback is used for local `pnpm build` runs.
if (process.env.VERCEL_PROJECT_PRODUCTION_URL && !process.env.VITE_SITE_URL) {
  process.env.VITE_SITE_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
}
const PATTERNS_DIR = path.join(__dirname, "patterns");

// Read version strings at config time so they're baked into the bundle
// as literals — no manual sync required when packages are upgraded.
const appPkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
);
const strudelCorePkg = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "node_modules/@strudel/core/package.json"),
    "utf8",
  ),
);

// Inject the self-hosted Umami <script> into index.html ONLY when both env
// vars are set. When either is blank (default in .env.production, always
// in dev unless a local override exists) the tag is omitted entirely — no
// network request, no console noise, no way for analytics to break the
// app. The `async` + `defer` attributes keep the fetch off the critical
// path regardless.
function umamiPlugin() {
  let src = "";
  let id = "";
  return {
    name: "strasbeat:umami",
    config(_, { mode }) {
      const env = loadEnv(mode, __dirname, "VITE_");
      src = env.VITE_UMAMI_SRC || "";
      id = env.VITE_UMAMI_WEBSITE_ID || "";
    },
    transformIndexHtml() {
      if (!src || !id) return;
      return [
        {
          tag: "script",
          attrs: {
            async: true,
            defer: true,
            "data-website-id": id,
            src,
          },
          injectTo: "head",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [patternSavePlugin(PATTERNS_DIR, __dirname), umamiPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(appPkg.version),
    __STRUDEL_VERSION__: JSON.stringify(strudelCorePkg.version),
  },
  // Bumped from Vite's default (es2020) so top-level await is emitted
  // as-is. es2022 is the lowest target that ships TLA natively; the
  // share-link flow relies on it (src/main.js awaits readSharedFromHash).
  // The effective browser floor is already Safari 16.4+ / Chrome 80+
  // because of CompressionStream, so this does not regress support.
  build: { target: "es2022" },
  // Don't let Vite's dep scanner wander into strudel-source/, and skip
  // *.test.js — those run under `node --test` (see scripts/test-loader.mjs)
  // and may import devDeps installed only transitively (e.g.
  // @codemirror/lang-javascript via @strudel/codemirror).
  optimizeDeps: {
    entries: [
      "index.html",
      "src/**/*.{js,mjs,ts}",
      "!src/**/*.test.{js,mjs,ts}",
      "patterns/*.js",
    ],
  },
  server: {
    port: 5173,
    open: false,
    fs: {
      // serve files only from this project, not the cloned strudel-source
      allow: [__dirname],
      deny: ["strudel-source/**"],
    },
    // strudel.cc serves sample manifests without CORS headers, so we can't
    // fetch them directly from a localhost origin — proxy them instead.
    proxy: {
      "/strudel-cc": {
        target: "https://strudel.cc",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/strudel-cc/, ""),
      },
    },
  },
});
