export function installTabShortcuts({ tabs, focusEditor, root = document }) {
  function onKeydown(event) {
    if (
      event.defaultPrevented ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    // AltGr text input and modal controls must not switch the editor behind them.
    if (
      event.getModifierState?.("AltGraph") ||
      event.target?.closest?.('[role="dialog"], .settings-pop, .palette')
    )
      return;
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const name = tabs.getOpenItems()[Number(event.key) - 1];
      if (name) {
        tabs.openOrFocus(name);
        focusEditor();
      }
    } else if (event.key.toLowerCase() === "a" && tabs.getActiveItem()) {
      event.preventDefault();
      event.stopPropagation();
      tabs.togglePin();
      focusEditor();
    }
  }
  root.addEventListener("keydown", onKeydown, { capture: true });
  return () =>
    root.removeEventListener("keydown", onKeydown, { capture: true });
}
