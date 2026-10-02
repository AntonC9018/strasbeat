import { test } from "node:test";
import assert from "node:assert/strict";
import { Vim } from "@replit/codemirror-vim";
import { EditorState } from "@codemirror/state";
import {
  installNeovimKeymap,
  clipboardSelection,
  normalizeClipboardText,
  replacementText,
} from "./neovim-keymap.js";

test("gr replacement strips yank newline for words and retains line boundaries for grr", () => {
  assert.equal(replacementText("new\n", false, "old"), "new");
  assert.equal(replacementText("new\n", true, "old\n"), "new\n");
  assert.equal(replacementText("new", true, "old\n"), "new\n");
  assert.equal(replacementText("new\n", true, "old"), "new");
});

test("normal Space+y copies complete lines including newline and honors a count", () => {
  const state = EditorState.create({
    doc: "  alpha\n    beta\ngamma",
    selection: { anchor: 4 },
  });
  assert.deepEqual(clipboardSelection(state, {}), {
    text: "  alpha\n",
    linewise: true,
  });
  assert.deepEqual(clipboardSelection(state, {}, { repeat: 2 }), {
    text: "  alpha\n    beta\n",
    linewise: true,
  });
});

test("normal Space+c preserves the config's characterwise whole-line behavior", () => {
  const state = EditorState.create({
    doc: "  alpha",
    selection: { anchor: 4 },
  });
  assert.deepEqual(clipboardSelection(state, {}, { deindent: true }), {
    text: "  alpha",
    linewise: false,
  });
});

test("visual Space+c expands to lines, strips common indentation, excludes next line", () => {
  const state = EditorState.create({
    doc: "  alpha\n    beta\ngamma",
    selection: { anchor: 2, head: 17 },
  });
  assert.deepEqual(
    clipboardSelection(state, { visualMode: true }, { deindent: true }),
    {
      text: "alpha\n  beta\n",
      linewise: true,
    },
  );
});

test("visual Space+y copies only the selected characters; linewise gets a newline at EOF", () => {
  const state = EditorState.create({
    doc: "alpha",
    selection: { anchor: 1, head: 4 },
  });
  assert.deepEqual(clipboardSelection(state, { visualMode: true }), {
    text: "lph",
    linewise: false,
    blockwise: false,
  });
  const line = EditorState.create({
    doc: "alpha",
    selection: { anchor: 0, head: 5 },
  });
  assert.equal(
    clipboardSelection(line, { visualMode: true, visualLine: true }).text,
    "alpha\n",
  );
});

test("clipboard paste normalizes Windows and legacy Mac newlines", () => {
  assert.equal(
    normalizeClipboardText("one\r\ntwo\rthree\n"),
    "one\ntwo\nthree\n",
  );
});

test("explicit system registers write clipboard while named and black-hole registers retain Vim semantics", async () => {
  const writes = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text) => {
          writes.push(text);
        },
      },
    },
  });
  try {
    installNeovimKeymap();
    const controller = Vim.getRegisterController();
    controller.pushText("*", "yank", "star", true);
    assert.equal(controller.getRegister("+").toString(), "star\n");
    assert.equal(controller.getRegister('"').toString(), "star\n");
    assert.equal(controller.getRegister("*").linewise, true);
    controller.pushText("+", "yank", "block", false, true);
    assert.equal(controller.getRegister("*").blockwise, true);
    assert.deepEqual(writes, ["star\n", "block"]);
    controller.pushText("a", "yank", "named", false);
    controller.pushText("A", "yank", " appended", false);
    assert.equal(controller.getRegister("a").toString(), "named appended");
    controller.pushText("_", "delete", "discarded", true);
    assert.equal(controller.getRegister('"').toString(), "named appended");
    controller.pushText(undefined, "yank", "ordinary", false);
    assert.equal(controller.getRegister("0").toString(), "ordinary");
    controller.pushText(undefined, "delete", "removed", true);
    assert.equal(controller.getRegister("1").toString(), "removed\n");
    assert.equal(controller.getRegister("*").toString(), "block");
    assert.equal(
      writes.length,
      2,
      "ordinary Vim operations must not alter system clipboard",
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  }
});
