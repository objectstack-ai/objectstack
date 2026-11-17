/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { cn, type FormSectionNavItem, type FormSectionNavSink } from '@object-ui/components';
import { createSafeTranslation } from '@object-ui/i18n';

// Must stay byte-identical to the `en` pack values — `pnpm check:i18n-keys`
// compares this table against them.
const useSectionNavTranslation = createSafeTranslation(
  {
    'form.sectionNav': 'Form sections',
    'form.sectionNavErrors': 'Fields to fix: {{number}}',
  },
  'form.sectionNav',
);

/**
 * The host half of the form section navigation (objectstack#34605): a stable
 * sink to provide through `FormSectionNavContext`, and the section list the
 * form below it last reported. `items` is `null` until a sectioned form
 * reports, and again when it draws no stacked sections.
 */
export function useFormSectionNav(): { sink: FormSectionNavSink; items: FormSectionNavItem[] | null } {
  const [items, setItems] = React.useState<FormSectionNavItem[] | null>(null);
  // `setItems` is stable for the life of the host, so the sink never re-keys
  // the form's report.
  return { sink: setItems, items };
}

/** How far below the scroller's top edge a heading still counts as the current section. */
const SCROLL_SPY_OFFSET = 24;

/**
 * After a click, the jump's own scroll events must not move the highlight
 * through the sections it passes on the way. When the hold ends the highlight
 * is measured once more, so a scroll that landed inside the hold — a refused
 * submit taking the form back to its first error — is followed too.
 */
const CLICK_HOLD_MS = 800;

/** The nearest ancestor that scrolls vertically, or `null` for the window. */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

export interface FormSectionNavProps {
  /** The sections the form reported — `useFormSectionNav().items`. */
  items: FormSectionNavItem[] | null;
  className?: string;
}

/**
 * The section navigation of a stacked sectioned form (objectstack#34605).
 *
 * One entry per visible section heading, in form order. A click scrolls to the
 * section — unfolding it first when it is collapsed — and the entry of the
 * section in view is highlighted as the form scrolls. An entry carries the
 * number of fields in its section that hold a validation error, so a refused
 * submit shows which sections need attention.
 *
 * Drawn only with two or more visible sections; a host never configures it,
 * and a tabbed or paned form reports no sections, so it draws nothing there.
 */
export function FormSectionNav({ items, className }: FormSectionNavProps) {
  const { t } = useSectionNavTranslation();
  const [current, setCurrent] = React.useState<string | undefined>(undefined);
  // While set, the jump a click started is under way: see CLICK_HOLD_MS.
  const holding = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // The section the last click jumped to, while the form stays at its bottom:
  // a short tail shows several headings at once and the click picks one.
  const jumpedTo = React.useRef<string | null>(null);
  // Re-reads the scroll position; bound by the scroll spy below.
  const remeasure = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => {
    if (holding.current) clearTimeout(holding.current);
  }, []);
  const shown = items && items.length >= 2 ? items : null;
  const anchorIds = shown ? shown.map((i) => i.anchorId).join('\n') : '';

  // Scroll spy: the current section is the last heading at or above the
  // scroller's top edge; at the very bottom it is the section a click jumped
  // to when its heading is in view, else the last section, whose heading may
  // never reach the top on a short tail.
  React.useEffect(() => {
    if (!anchorIds) return;
    const ids = anchorIds.split('\n');
    const keyByAnchor = new Map((shown ?? []).map((i) => [i.anchorId, i.key]));
    const first = document.getElementById(ids[0]);
    if (!first) return;
    const scroller = scrollParentOf(first);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (holding.current) return;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const atBottom = scroller
        ? scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
        : window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let found = ids[0];
      if (atBottom) {
        const clicked = jumpedTo.current ? document.getElementById(jumpedTo.current) : null;
        const viewBottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
        const clickedTop = clicked ? clicked.getBoundingClientRect().top : NaN;
        found = clickedTop >= top && clickedTop < viewBottom ? jumpedTo.current! : ids[ids.length - 1];
      } else {
        jumpedTo.current = null;
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top - top <= SCROLL_SPY_OFFSET) found = id;
        }
      }
      setCurrent(keyByAnchor.get(found));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    remeasure.current = onScroll;
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      remeasure.current = null;
      target.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
    // `anchorIds` stands for `shown`: the listener only needs re-binding when
    // the set of headings changes, not when a count does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorIds]);

  const active = shown ? (shown.some((i) => i.key === current) ? current : shown[0].key) : undefined;

  // Keep the current entry in view inside the strip, which scrolls sideways
  // on a narrow screen. The strip's own scroll offset only: an element
  // `scrollIntoView` here would also move the form and cut a jump short.
  const navRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const strip = navRef.current;
    const entry = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !entry) return;
    const left = entry.offsetLeft;
    const right = left + entry.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, [active]);

  if (!shown) return null;

  const jump = (item: FormSectionNavItem) => {
    if (holding.current) clearTimeout(holding.current);
    holding.current = setTimeout(() => {
      holding.current = null;
      remeasure.current?.();
    }, CLICK_HOLD_MS);
    jumpedTo.current = item.anchorId;
    setCurrent(item.key);
    const reveal = () =>
      document.getElementById(item.anchorId)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    if (item.collapsed) {
      item.expand();
      // The unfolded fields mount on the next render; scroll once they have.
      requestAnimationFrame(reveal);
    } else {
      reveal();
    }
  };

  return (
    <nav
      ref={navRef}
      aria-label={t('form.sectionNav')}
      data-testid="form-section-nav"
      className={cn('relative flex gap-1 overflow-x-auto border-b border-border', className)}
    >
      {shown.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => jump(item)}
            aria-current={isActive ? 'true' : undefined}
            data-testid={`form-section-nav:${item.key}`}
            data-error={item.errorCount > 0 || undefined}
            className={cn(
              '-mb-px inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 py-2 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.errorCount > 0 && (
              <span className="text-xs font-medium text-destructive" data-testid={`form-section-nav-count:${item.key}`}>
                <span aria-hidden="true">{`· ${item.errorCount}`}</span>
                <span className="sr-only">{t('form.sectionNavErrors', { number: item.errorCount })}</span>
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
