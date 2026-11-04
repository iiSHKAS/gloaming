/**
 * The CSS zoom in force on an element, counting every ancestor.
 *
 * Menus and pop-overs sit in a position: fixed box inside the zoomed app, and
 * zoom scales the offsets of a fixed box as well. Pointer and getBoundingClientRect
 * coordinates are on screen, so they are divided by this before they are used
 * as left / top, or the box lands further from its anchor the more it is zoomed.
 */
export function zoomOf(element: Element | null): number {
  let zoom = 1;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = parseFloat(getComputedStyle(node).zoom);
    if (Number.isFinite(value) && value > 0) zoom *= value;
  }
  return zoom || 1;
}
