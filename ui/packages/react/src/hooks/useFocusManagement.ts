/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

// ─── useFocusReturn ────────────────────────────────────────────────────────────

export interface FocusReturnOptions {
  /** Whether focus restoration is enabled. @default true */
  enabled?: boolean;
  /** Whether to focus the previously active element on unmount. @default true */
  restoreOnUnmount?: boolean;
}

/**
 * Hook that captures the currently focused element on mount and restores
 * focus to it when the component unmounts. Useful for modals, drawers,
 * and overlays that temporarily steal focus.
 *
 * @example
 * ```tsx
 * function Drawer({ onClose }: { onClose: () => void }) {
 *   const { returnFocus } = useFocusReturn();
 *
 *   const handleClose = () => {
 *     returnFocus();
 *     onClose();
 *   };
 *
 *   return <aside>...</aside>;
 * }
 * ```
 */
export function useFocusReturn(options: FocusReturnOptions = {}): {
  /** Manually restore focus to the previously focused element. */
  returnFocus: () => void;
} {
  const { enabled = true, restoreOnUnmount = true } = options;
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Capture focused element on mount
  useEffect(() => {
    if (!enabled) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
  }, [enabled]);

  const returnFocus = useCallback(() => {
    if (!enabled) return;
    const el = previousFocusRef.current;
    if (el && typeof el.focus === 'function' && document.body.contains(el)) {
      el.focus();
    }
  }, [enabled]);

  // Restore on unmount
  useEffect(() => {
    if (!enabled || !restoreOnUnmount) return;
    return () => {
      const el = previousFocusRef.current;
      if (el && typeof el.focus === 'function' && document.body.contains(el)) {
        el.focus();
      }
    };
    // Only run cleanup on unmount — intentionally stable deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { returnFocus };
}

// ─── useRovingFocus ────────────────────────────────────────────────────────────

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

export interface RovingFocusOptions {
  /** Whether roving focus is enabled. @default true */
  enabled?: boolean;
  /** Navigation orientation. @default 'vertical' */
  orientation?: RovingOrientation;
  /** Whether focus wraps from last to first item and vice-versa. @default true */
  loop?: boolean;
  /** Callback fired when the focused index changes. */
  onFocusChange?: (index: number) => void;
}

export interface RovingFocusReturn<T extends HTMLElement> {
  /** Ref to attach to the container element. */
  containerRef: React.RefObject<T | null>;
  /** The index of the currently focused item (-1 if none). */
  focusedIndex: number;
  /** Programmatically focus a specific item by index. */
  setFocusedIndex: (index: number) => void;
}

/**
 * Hook that implements roving tabindex / arrow-key navigation for a list of
 * focusable items inside a container (sidebar items, tab lists, menu items).
 *
 * Only the currently active item participates in the tab order (tabindex 0);
 * all other items are removed from the tab order (tabindex -1). Arrow keys
 * move focus between items.
 *
 * @example
 * ```tsx
 * function SidebarNav({ items }: { items: string[] }) {
 *   const { containerRef, focusedIndex } = useRovingFocus<HTMLUListElement>({
 *     orientation: 'vertical',
 *     loop: true,
 *   });
 *
 *   return (
 *     <ul ref={containerRef} role="tablist">
 *       {items.map((item, i) => (
 *         <li
 *           key={item}
 *           role="tab"
 *           tabIndex={i === focusedIndex ? 0 : -1}
 *           data-roving-item
 *         >
 *           {item}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useRovingFocus<T extends HTMLElement = HTMLDivElement>(
  options: RovingFocusOptions = {}
): RovingFocusReturn<T> {
  const {
    enabled = true,
    orientation = 'vertical',
    loop = true,
    onFocusChange,
  } = options;

  const containerRef = useRef<T | null>(null);
  const [focusedIndex, setFocusedIndexState] = useState(-1);
  const onFocusChangeRef = useRef(onFocusChange);
  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  const getItems = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>('[data-roving-item]')
    ).filter((el) => {
      // Exclude hidden or disabled elements
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
        return false;
      }
      return el.offsetParent !== null; // visible check
    });
  }, []);

  const setFocusedIndex = useCallback(
    (index: number) => {
      const items = getItems();
      if (items.length === 0) return;

      const clamped = Math.max(0, Math.min(index, items.length - 1));
      setFocusedIndexState(clamped);
      items[clamped]?.focus();
      onFocusChangeRef.current?.(clamped);
    },
    [getItems]
  );

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const items = getItems();
      if (items.length === 0) return;

      const currentIndex = items.findIndex((el) => el === document.activeElement);
      if (currentIndex === -1) return;

      const prevKeys =
        orientation === 'horizontal' ? ['ArrowLeft'] :
        orientation === 'vertical' ? ['ArrowUp'] :
        ['ArrowUp', 'ArrowLeft'];

      const nextKeys =
        orientation === 'horizontal' ? ['ArrowRight'] :
        orientation === 'vertical' ? ['ArrowDown'] :
        ['ArrowDown', 'ArrowRight'];

      let nextIndex: number | null = null;

      if (prevKeys.includes(event.key)) {
        event.preventDefault();
        if (currentIndex > 0) {
          nextIndex = currentIndex - 1;
        } else if (loop) {
          nextIndex = items.length - 1;
        }
      } else if (nextKeys.includes(event.key)) {
        event.preventDefault();
        if (currentIndex < items.length - 1) {
          nextIndex = currentIndex + 1;
        } else if (loop) {
          nextIndex = 0;
        }
      } else if (event.key === 'Home') {
        event.preventDefault();
        nextIndex = 0;
      } else if (event.key === 'End') {
        event.preventDefault();
        nextIndex = items.length - 1;
      }

      if (nextIndex !== null) {
        setFocusedIndexState(nextIndex);
        items[nextIndex].focus();
        onFocusChangeRef.current?.(nextIndex);
      }
    };

    // When an item receives focus (e.g. via click), sync the index
    const handleFocusIn = (event: FocusEvent) => {
      const items = getItems();
      const index = items.findIndex((el) => el === event.target);
      if (index !== -1) {
        setFocusedIndexState(index);
        onFocusChangeRef.current?.(index);
      }
    };

    const container = containerRef.current;
    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('focusin', handleFocusIn);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('focusin', handleFocusIn);
    };
  }, [enabled, orientation, loop, getItems]);

  return { containerRef, focusedIndex, setFocusedIndex };
}
