/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useCallback } from 'react';

export interface FocusTrapOptions {
  /** Whether the focus trap is currently active */
  enabled?: boolean;
  /** Whether to auto-focus the first focusable element on mount */
  autoFocus?: boolean;
  /** Whether to restore focus to the previously focused element on unmount */
  restoreFocus?: boolean;
  /** Whether to release the trap on Escape key */
  escapeDeactivates?: boolean;
  /** Callback when Escape is pressed (if escapeDeactivates is true) */
  onEscape?: () => void;
  /** Initial element to focus (CSS selector) */
  initialFocus?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Hook that traps focus within a container element.
 * Implements FocusTrapConfigSchema from @objectstack/spec v2.0.7.
 *
 * @example
 * ```tsx
 * function Modal({ onClose }: { onClose: () => void }) {
 *   const trapRef = useFocusTrap({
 *     enabled: true,
 *     autoFocus: true,
 *     restoreFocus: true,
 *     escapeDeactivates: true,
 *     onEscape: onClose,
 *   });
 *
 *   return <div ref={trapRef}>...</div>;
 * }
 * ```
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  options: FocusTrapOptions = {}
): React.RefObject<T | null> {
  const {
    enabled = true,
    autoFocus = true,
    restoreFocus = true,
    escapeDeactivates = false,
    onEscape,
    initialFocus,
  } = options;

  const containerRef = useRef<T | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0);
  }, []);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    // Save previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Auto-focus
    if (autoFocus) {
      const focusableElements = getFocusableElements();
      if (initialFocus) {
        const target = containerRef.current.querySelector<HTMLElement>(initialFocus);
        if (target) {
          target.focus();
        } else if (focusableElements.length > 0) {
          focusableElements[0].focus();
        }
      } else if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!containerRef.current) return;

      if (event.key === 'Escape' && escapeDeactivates) {
        onEscape?.();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    const container = containerRef.current;
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (restoreFocus && previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, [enabled, autoFocus, restoreFocus, escapeDeactivates, onEscape, initialFocus, getFocusableElements]);

  return containerRef;
}
