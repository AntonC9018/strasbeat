import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listNavigationKey,
  installSelectNavigation,
} from "./list-navigation.js";

test("Ctrl+j/k move down/up but plain j/k and other modifiers don't", () => {
  assert.equal(listNavigationKey({ key: "j", ctrlKey: true }), "ArrowDown");
  assert.equal(listNavigationKey({ key: "k", ctrlKey: true }), "ArrowUp");
  for (const extra of [
    {},
    { ctrlKey: true, altKey: true },
    { ctrlKey: true, shiftKey: true },
  ]) {
    assert.equal(listNavigationKey({ key: "j", ...extra }), "j");
  }
});

test("select navigation skips disabled options, emits change once, and stops at ends", () => {
  const root = new EventTarget();
  const cleanup = installSelectNavigation(root);
  let changes = 0;
  const select = {
    tagName: "SELECT",
    selectedIndex: 0,
    options: [
      {},
      { disabled: true },
      { parentElement: { disabled: true } },
      {},
    ],
    dispatchEvent: (event) => {
      assert.equal(event.type, "change");
      changes++;
    },
  };
  const press = (key, target = select) => {
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperties(event, {
      target: { value: target },
      key: { value: key },
      ctrlKey: { value: true },
    });
    root.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(press("j"), true);
  assert.equal(select.selectedIndex, 3);
  press("j");
  assert.equal(changes, 1);
  press("k");
  assert.equal(select.selectedIndex, 0);
  assert.equal(changes, 2);
  assert.equal(press("j", { tagName: "INPUT" }), false);
  cleanup();
  press("j");
  assert.equal(select.selectedIndex, 0);
});
