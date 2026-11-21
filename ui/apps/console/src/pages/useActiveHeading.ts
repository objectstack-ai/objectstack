/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useState } from 'react';

/**
 * How far below the viewport's top a heading counts as "being read": the app
 * bar (48 px) plus the headings' own scroll margin (`scroll-mt-24`, 96 px)
 * leaves the heading a reader just jumped to at about 96 px; a little more
 * keeps it current while its first lines are read.
 */
export const ACTIVE_HEADING_OFFSET = 120;

/**
 * Which of `ids` (in document order) the reader is in: the last heading whose
 * top is at or above `offset`, the first one before any is, and the last one
 * once the page is scrolled to its end (a short final section never reaches
 * the top). Pure, for the hook and its test.
 */
export function pickActiveHeading(
  tops: ReadonlyArray<{ id: string; top: number }>,
  offset: number,
  atEnd: boolean,
): string | null {
  if (tops.length === 0) return null;
  if (atEnd) return tops[tops.length - 1].id;
  let active = tops[0].id;
  for (const { id, top } of tops) {
    if (top <= offset) active = id;
    else break;
  }
  return active;
}

/** Is the box that scrolled scrolled to its end? */
function scrolledToEnd(el: Element): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
}

/**
 * The id of the heading the reader is in, for the "On this page" column
 * (objectstack#35424). The reader's page scrolls inside the app shell's
 * content box, not the window, so scrolls are heard on the document in the
 * capture phase, which every scrolling box reaches. Re-read once per frame.
 */
export function useActiveHeading(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('\u0000');

  useEffect(() => {
    const list = key ? key.split('\u0000') : [];
    if (list.length === 0) {
      setActive(null);
      return;
    }
    let frame = 0;
    // The box the last scroll came from: the page's scrolling element for a
    // scroll of the document itself.
    let lastTarget: Element | null = null;
    const measure = () => {
      frame = 0;
      const tops: { id: string; top: number }[] = [];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el) tops.push({ id, top: el.getBoundingClientRect().top });
      }
      setActive(pickActiveHeading(tops, ACTIVE_HEADING_OFFSET, lastTarget !== null && scrolledToEnd(lastTarget)));
    };
    const schedule = (event?: Event) => {
      if (event) {
        const target = event.target === document ? document.scrollingElement : event.target;
        // Only the box that scrolls the article counts: a side column that
        // scrolls on its own says nothing about the reader's place.
        const first = document.getElementById(list[0]);
        if (target instanceof Element && first && target.contains(first)) lastTarget = target;
      }
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [key]);

  return active;
}
