import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TooltipProps = {
  label: ReactNode;
  /** Wrapper element tag; defaults to a span. */
  as?: 'span' | 'div';
  className?: string;
  children: ReactNode;
};

/**
 * Lightweight custom tooltip. Wrap any element; on hover a styled bubble is
 * rendered in a portal above the target, replacing the native `title=` popup.
 */
export function Tooltip({ label, as = 'span', className, children }: TooltipProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function show() {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  }

  const Wrapper = as as 'span';
  return (
    <Wrapper
      ref={ref as never}
      className={className}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && label
        ? createPortal(
            <div className="app-tooltip" style={{ left: pos.x, top: pos.y }} role="tooltip">
              {label}
            </div>,
            document.body
          )
        : null}
    </Wrapper>
  );
}
