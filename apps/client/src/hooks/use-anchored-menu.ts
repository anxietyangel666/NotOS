import { useLayoutEffect, useState } from 'react';

type Point = { x: number; y: number };

/**
 * Keeps a floating menu (context menu / popover) fully inside the viewport.
 *
 * Pass the desired anchor point (usually the mouse position) plus a ref to the
 * rendered menu element. After layout, the menu's real size is measured and the
 * returned coordinates are nudged so the menu never overflows the right/bottom
 * edges (and never goes off the top/left). This avoids hardcoded size guesses
 * that fail for tall menus (e.g. a message menu with a reactions row).
 *
 * Returns the adjusted { x, y } to apply as `left` / `top`.
 */
export function useAnchoredMenu(
  anchor: Point | null,
  menuRef: { current: HTMLElement | null },
  margin = 8
): Point {
  const [pos, setPos] = useState<Point>(anchor ?? { x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const el = menuRef.current;
    if (!el) {
      setPos(anchor);
      return;
    }
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer the anchor, but pull the menu left/up if it would overflow.
    let x = anchor.x;
    let y = anchor.y;
    if (x + rect.width + margin > vw) x = vw - rect.width - margin;
    if (y + rect.height + margin > vh) y = vh - rect.height - margin;
    x = Math.max(margin, x);
    y = Math.max(margin, y);
    setPos({ x, y });
  }, [anchor?.x, anchor?.y, menuRef, margin]);

  return pos;
}
