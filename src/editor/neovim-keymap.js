import { Vim } from "@replit/codemirror-vim";

let installed = false;

export function normalizeClipboardText(text) {
  return text.replace(/\r\n?/g, "\n");
}

// Match lua/core/mappings.lua: normal Space+c copies the whole line as
// characters; visual Space+c copies whole lines with their common indent removed.
export function clipboardSelection(
  state,
  vim,
  { deindent = false, repeat = 1 } = {},
) {
  const { doc, selection } = state;
  const range = selection.main;
  const first = doc.lineAt(range.from);
  if (deindent && vim.visualMode) {
    const from = Math.min(...selection.ranges.map((range) => range.from));
    const to = Math.max(...selection.ranges.map((range) => range.to));
    const start = doc.lineAt(from);
    const last = doc.lineAt(Math.max(from, to - 1));
    const lines = [];
    for (let n = start.number; n <= last.number; n++)
      lines.push(doc.line(n).text);
    const indent = Math.min(
      ...lines.map((line) => line.match(/^\s*/)[0].length),
    );
    return {
      text: lines.map((line) => line.slice(indent)).join("\n") + "\n",
      linewise: true,
    };
  }
  if (vim.visualMode) {
    let text = selection.ranges
      .map((range) => state.sliceDoc(range.from, range.to))
      .join("\n");
    if (vim.visualLine && !text.endsWith("\n")) text += "\n";
    return { text, linewise: !!vim.visualLine, blockwise: !!vim.visualBlock };
  }
  if (deindent) return { text: first.text, linewise: false };
  const last = doc.line(Math.min(doc.lines, first.number + repeat - 1));
  return { text: state.sliceDoc(first.from, last.to) + "\n", linewise: true };
}

function clipboardFailure(cm, error) {
  console.warn("[strasbeat/clipboard]", error);
  const message = document.createElement("span");
  message.textContent =
    "System clipboard unavailable: " + (error?.message ?? String(error));
  cm.openNotification(message, { bottom: true, duration: 5000 });
}

export function installNeovimKeymap() {
  if (installed) return;
  installed = true;

  // CM-Vim resolves a full match before any longer sequence. Its built-in
  // Space → l would consume the leader before Space+y/c/p could complete.
  Vim.unmap("<Space>");
  Vim.map("<Space>", "l", "operatorPending");

  // Use the same clipboard register through an alias, so Vim's paste action
  // consumes the text we have already read and normalized instead of reading
  // navigator.clipboard a second time. Stock + bindings still work.
  Vim.defineRegister("~", Vim.getRegisterController().getRegister("+"));

  Vim.defineAction("strasbeatClipboardCopy", (cm, args, vim) => {
    const copied = clipboardSelection(cm.cm6.state, vim, args);
    Vim.getRegisterController()
      .getRegister("+")
      .setText(copied.text, copied.linewise, copied.blockwise);
    Vim.getRegisterController()
      .getRegister()
      .setText(copied.text, copied.linewise, copied.blockwise);
    try {
      navigator.clipboard
        .writeText(copied.text)
        .catch((error) => clipboardFailure(cm, error));
    } catch (error) {
      clipboardFailure(cm, error);
    }
    if (vim.visualMode) Vim.exitVisualMode(cm);
  });

  Vim.defineAction("strasbeatClipboardPaste", (cm, args, vim) => {
    const state = cm.cm6.state;
    const visual = vim.visualMode;
    const paste = async () => {
      const text = normalizeClipboardText(await navigator.clipboard.readText());
      // Clipboard permission prompts can take a while. Don't paste into a
      // different tab or at a cursor that has moved while the prompt was open.
      if (
        cm.cm6.state.doc !== state.doc ||
        !cm.cm6.state.selection.eq(state.selection)
      )
        return;
      const register = Vim.getRegisterController().getRegister("+");
      const linewise =
        text === register.toString() ? register.linewise : text.endsWith("\n");
      const blockwise = text === register.toString() && register.blockwise;
      register.setText(text, linewise, blockwise);
      for (const key of `"~${args.repeat > 1 ? args.repeat : ""}${args.before ? "P" : "p"}`)
        Vim.handleKey(cm, key);
      if (visual && text) {
        Vim.handleKey(cm, "g");
        Vim.handleKey(cm, "v");
      }
      cm.cm6.focus();
    };
    paste().catch((error) => clipboardFailure(cm, error));
  });

  for (const context of ["normal", "visual"]) {
    Vim.mapCommand(
      "<Space>y",
      "action",
      "strasbeatClipboardCopy",
      {},
      { context },
    );
    Vim.mapCommand(
      "<Space>c",
      "action",
      "strasbeatClipboardCopy",
      { deindent: true },
      { context },
    );
    Vim.mapCommand(
      "<Space>p",
      "action",
      "strasbeatClipboardPaste",
      {},
      { context },
    );
    Vim.mapCommand(
      "<Space>P",
      "action",
      "strasbeatClipboardPaste",
      { before: true },
      { context },
    );
  }
}
