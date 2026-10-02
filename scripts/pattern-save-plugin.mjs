import fs from "node:fs";
import path from "node:path";

// Vite middleware: write the editor's current code to patterns/<name>.js
// so the dev workflow is: iterate in the browser → save → commit.
export function patternSavePlugin(patternsDir, projectDir) {
  return {
    name: "strasbeat:pattern-save",
    // Run after Vite's import-glob hook, including file creation/deletion.
    enforce: "post",
    hotUpdate({ type, file, modules, timestamp }) {
      if (path.dirname(file) !== patternsDir || !file.endsWith(".js")) return;
      for (const mod of modules) {
        this.environment.moduleGraph.invalidateModule(mod);
      }
      this.environment.hot.send({
        type: "custom",
        event: "strasbeat:pattern-changed",
        data: { type, name: path.basename(file, ".js"), timestamp },
      });
      // The editor owns live state. A saved pattern must never re-run main.js.
      return [];
    },
    configureServer(server) {
      server.middlewares.use("/api/save", async (req, res, next) => {
        if (req.method !== "POST") return next();
        // Cap request body at 1MB to prevent accidental memory exhaustion.
        const MAX_BODY = 1024 * 1024;
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > MAX_BODY) {
            res.statusCode = 413;
            return res.end(
              JSON.stringify({ ok: false, error: "payload too large" }),
            );
          }
        }
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: "invalid json" }));
        }
        const { name, code } = payload;
        if (typeof name !== "string" || !/^[a-z0-9_-]+$/i.test(name)) {
          res.statusCode = 400;
          return res.end(
            JSON.stringify({
              ok: false,
              error: "name must match /^[a-z0-9_-]+$/i",
            }),
          );
        }
        if (typeof code !== "string") {
          res.statusCode = 400;
          return res.end(
            JSON.stringify({ ok: false, error: "code must be a string" }),
          );
        }
        const escaped = code
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\$\{/g, "\\${");
        const file = `export default \`${escaped}\`;\n`;
        const target = path.join(patternsDir, `${name}.js`);
        try {
          fs.mkdirSync(patternsDir, { recursive: true });
          fs.writeFileSync(target, file, "utf8");
        } catch (err) {
          console.error("[strasbeat/api/save] write failed:", err);
          res.statusCode = 500;
          return res.end(
            JSON.stringify({
              ok: false,
              error: `write failed: ${err.message}`,
            }),
          );
        }
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({ ok: true, path: path.relative(projectDir, target) }),
        );
      });
    },
  };
}
