import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { patternSavePlugin } from "./pattern-save-plugin.mjs";

// Exercise Vite's real watcher + import-glob graph, rather than mocking the
// plugin hook: new files previously hot-updated main.js and reloaded the UI.
test("disk create/update/delete refresh the library without reloading the app", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "strasbeat-save-"));
  const patternsDir = path.join(root, "patterns");
  let server;
  try {
    await mkdir(patternsDir);
    await writeFile(
      path.join(patternsDir, "existing.js"),
      'export default "old";',
    );
    await writeFile(
      path.join(root, "index.html"),
      '<script type="module" src="/main.js"></script>',
    );
    await writeFile(
      path.join(root, "main.js"),
      'export const patterns = import.meta.glob("./patterns/*.js", {eager:true}); if (import.meta.hot) import.meta.hot.accept(() => location.reload());',
    );
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [patternSavePlugin(patternsDir, root)],
      server: { port: 0, host: "127.0.0.1" },
      optimizeDeps: { noDiscovery: true },
    });
    await server.listen();
    const base = server.resolvedUrls.local[0];
    const messages = [];
    const hot = server.environments.client.hot;
    const send = hot.send.bind(hot);
    hot.send = (message, ...args) => {
      messages.push(message);
      send(message, ...args);
    };
    await fetch(base + "main.js");
    await fetch(base + "patterns/existing.js");
    const waitForChange = async (name, type) => {
      const deadline = Date.now() + 5000;
      while (
        !messages.some(
          (m) =>
            m.type === "custom" &&
            m.event === "strasbeat:pattern-changed" &&
            m.data.name === name &&
            m.data.type === type,
        )
      ) {
        assert.ok(Date.now() < deadline, `missing ${type} event for ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      // Drain any subsequent update from the same watcher operation.
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        messages.filter((m) => m.type === "full-reload" || m.type === "update")
          .length,
        0,
        "pattern save must not hot-update/reload main.js",
      );
      messages.length = 0;
    };
    const save = async (name, code) => {
      const response = await fetch(base + "api/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, code }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        path: `patterns/${name}.js`,
      });
    };
    await save("existing", "updated");
    await waitForChange("existing", "update");
    assert.match(
      await (await fetch(base + "patterns/existing.js")).text(),
      /updated/,
    );
    // Template delimiters and escapes survive actual disk serialization.
    const code = "s(`bd ${name}`)\n// C:\\music";
    await save("created", code);
    await waitForChange("created", "create");
    assert.match(await (await fetch(base + "main.js")).text(), /created\.js/);
    assert.equal(
      (await server.ssrLoadModule("/patterns/created.js")).default,
      code,
    );
    await rm(path.join(patternsDir, "created.js"));
    await waitForChange("created", "delete");
    assert.doesNotMatch(
      await (await fetch(base + "main.js")).text(),
      /created\.js/,
    );
    const rejected = await fetch(base + "api/save", {
      method: "POST",
      body: JSON.stringify({ name: "../outside", code: "bad" }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
