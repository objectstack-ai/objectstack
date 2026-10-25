/**
 * useResizeObserver — observe an element's content-box size changes.
 *
 * Why this exists: many widgets historically read `window.innerWidth` and
 * branch on Tailwind-style breakpoints (`<640`, `<1024`). That's wrong for
 * any layout where the widget itself is *not* full-width — e.g. a Kanban
 * board inside a sidebar, a Gantt embedded in a card, or a popout window.
 * This hook returns the actual rendered size of a container so widgets can
 * adapt to their own slot, not the viewport.
 *
 * SSR-safe: returns `{ width: 0, height: 0 }` until hydration.
 *
 * Usage:
 * ```tsx
 * const ref = React.useRef<HTMLDivElement>(null);
 * const { width } = useResizeObserver(ref);
 * const taskListWidth = width < 640 ? 120 : width < 1024 ? 200 : 300;
 * return <div ref={ref}>…</div>;
 * ```
 */
import * as React from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

export function useResizeObserver<T extends Element>(
  ref: React.RefObject<T | null>,
): ElementSize {
  const [size, setSize] = React.useState<ElementSize>({ width: 0, height: 0 });

  React.useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    // Read the initial size synchronously — avoids the first render reporting
    // 0×0 and then a flash to the real size.
    const rect = node.getBoundingClientRect();
    setSize((prev) =>
      prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height },
    );

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Prefer borderBoxSize when available (more accurate when paddings/borders
      // change); fall back to contentRect for older Safari.
      let next: ElementSize;
      const bb = entry.borderBoxSize?.[0];
      if (bb) {
        next = { width: bb.inlineSize, height: bb.blockSize };
      } else {
        next = { width: entry.contentRect.width, height: entry.contentRect.height };
      }
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
