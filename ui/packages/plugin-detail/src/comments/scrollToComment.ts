/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36410 — scrolls a comment list so the comment `commentId` sits
 * in the middle of it (or at its top, when the comment is taller than the
 * list). Only `container` scrolls, never the page round it: the desktop panel
 * sits beside the record, which keeps where the reader is. `false` when the
 * comment is not drawn in `container`.
 */
export function scrollCommentIntoView(container: HTMLElement, commentId: string): boolean {
  const el = Array.from(container.querySelectorAll<HTMLElement>('[data-comment-id]')).find(
    (node) => node.getAttribute('data-comment-id') === commentId,
  );
  if (!el) return false;
  const box = container.getBoundingClientRect();
  const at = el.getBoundingClientRect();
  const margin = Math.max(0, (container.clientHeight - at.height) / 2);
  container.scrollTop = Math.max(0, container.scrollTop + (at.top - box.top) - margin);
  return true;
}
