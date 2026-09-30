import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { clipboardSelection, normalizeClipboardText } from "./neovim-keymap.js";

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
