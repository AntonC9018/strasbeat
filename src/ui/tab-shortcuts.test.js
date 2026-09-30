import { test } from "node:test";
import assert from "node:assert/strict";
import { installTabShortcuts } from "./tab-shortcuts.js";

test("Alt+number selects in strip order, Alt+a pins, modifiers and dialogs are ignored", () => {
  const root = new EventTarget();
  const focused = [];
  let pins = 0;
  let editorFocus = 0;
  const cleanup = installTabShortcuts({
    root,
    tabs: {
      getOpenItems: () => ["first", "second"],
      getActiveItem: () => "first",
      openOrFocus: (name) => focused.push(name),
      togglePin: () => pins++,
    },
    focusEditor: () => editorFocus++,
  });
  const press = (key, extra = {}) => {
    const event = new Event("keydown", { cancelable: true });
    for (const [name, value] of Object.entries({
      key,
      altKey: true,
      ...extra,
    })) {
      Object.defineProperty(event, name, { value });
    }
    root.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(press("2"), true);
  assert.deepEqual(focused, ["second"]);
  press("9");
  assert.deepEqual(focused, ["second"]);
  press("a");
  assert.equal(pins, 1);
  assert.equal(editorFocus, 2);
  assert.equal(press("1", { ctrlKey: true }), false);
  assert.equal(press("1", { getModifierState: () => true }), false);
  assert.equal(press("1", { target: { closest: () => ({}) } }), false);
  cleanup();
  assert.equal(press("a"), false);
  assert.equal(pins, 1);
});
