// Shared by picker inputs; don't translate keys globally in the editor.
export function listNavigationKey(event) {
  if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    if (event.key.toLowerCase() === "j") return "ArrowDown";
    if (event.key.toLowerCase() === "k") return "ArrowUp";
  }
  return event.key;
}

// Native selects don't expose their popup to JavaScript. Move the selected
// option while focused, skip disabled entries, and use the normal change path.
export function installSelectNavigation(root = document) {
  const onKeydown = (event) => {
    const select = event.target;
    if (select?.tagName !== "SELECT" || select.disabled || select.multiple)
      return;
    const key = listNavigationKey(event);
    if (key === event.key || (key !== "ArrowDown" && key !== "ArrowUp")) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = key === "ArrowDown" ? 1 : -1;
    for (
      let i = select.selectedIndex + direction;
      i >= 0 && i < select.options.length;
      i += direction
    ) {
      const option = select.options[i];
      if (option.disabled || option.parentElement?.disabled) continue;
      select.selectedIndex = i;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      break;
    }
  };
  root.addEventListener("keydown", onKeydown, { capture: true });
  return () =>
    root.removeEventListener("keydown", onKeydown, { capture: true });
}
