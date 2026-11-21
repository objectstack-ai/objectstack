/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { Hash } from 'lucide-react';
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

/**
 * How long a jumped-to section heading carries its mark
 * (`data-section-jumped`, styled by the heading row): the visible answer to a
 * click even when the heading was already in view and nothing scrolled
 * (objectstack#35472).
 */
export const JUMP_MARK_MS = 1600;

/** The attribute a jumped-to heading carries while marked. */
export const JUMP_MARK_ATTR = 'data-section-jumped';

/** The nearest ancestor that scrolls vertically, or `null` for the window. */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Bring a section heading to the top of its own scroller — the nearest
 * ancestor that scrolls, or the window — and move nothing else.
 *
 * Not an element `scrollIntoView`: that scrolls every scrollable ancestor,
 * an `overflow: hidden` box included. In the record dialog the dialog box
 * itself is one: absolutely positioned hidden inputs in the form (a Radix
 * checkbox's or select's native stand-in) can overflow it, and a short last
 * section that the form's scroller cannot bring to the top hands the rest of
 * the distance to the dialog box, which scrolls its title, this navigation
 * and the footer out of view with no way back (objectstack#35092).
 *
 * The heading's `scroll-margin-top` and the scroller's `scroll-padding-top`
 * are kept, as `scrollIntoView` keeps them.
 */
function scrollToHeading(heading: HTMLElement) {
  const scroller = scrollParentOf(heading);
  const margin = parseFloat(getComputedStyle(heading).scrollMarginTop) || 0;
  const headingTop = heading.getBoundingClientRect().top;
  if (scroller) {
    const padding = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
    const viewTop = scroller.getBoundingClientRect().top + scroller.clientTop;
    scroller.scrollTo({ top: scroller.scrollTop + headingTop - viewTop - margin - padding, behavior: 'smooth' });
  } else {
    const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    window.scrollTo({ top: window.scrollY + headingTop - margin - padding, behavior: 'smooth' });
  }
}

/**
 * The sections all fit: the scroller has nothing to scroll, so a jump could
 * never move anything (objectstack#35472). `false` while the scroller has no
 * height of its own yet (not laid out, or a layout-free test DOM): an unmeasured
 * box is not judged to fit.
 */
function contentFits(scroller: HTMLElement | null): boolean {
  if (scroller) {
    return scroller.clientHeight > 0 && scroller.scrollHeight <= scroller.clientHeight + 1;
  }
  const root = document.documentElement;
  return root.clientHeight > 0 && root.scrollHeight <= root.clientHeight + 1;
}

export interface FormSectionNavProps {
  /** The sections the form reported — `useFormSectionNav().items`. */
  items: FormSectionNavItem[] | null;
  className?: string;
  /**
   * Told whether the navigation is drawn, each time that changes — a host that
   * draws its own separator when there is no navigation (the record dialog's
   * header) follows the navigation's own decision, fit included.
   */
  onDrawnChange?: (drawn: boolean) => void;
}

/**
 * The section navigation of a stacked sectioned form (objectstack#34605).
 *
 * A JUMP BAR, not a tab strip (objectstack#35472): every section stays drawn,
 * stacked, and an entry takes the reader to its section. So it is drawn as a
 * row of jump links (a `#` glyph, a pill per entry), never as underlined tabs,
 * which read as "only the active group shows".
 *
 * One entry per visible section heading, in form order. A click scrolls to the
 * section — unfolding it first when it is collapsed — and marks its heading for
 * a moment, so a click always shows where it went, even when the heading was
 * already in view. The entry of the section in view is highlighted as the form
 * scrolls. An entry carries the number of fields in its section that hold a
 * validation error, so a refused submit shows which sections need attention.
 *
 * Drawn only with two or more visible sections, and only while the sections do
 * not all fit their scroller: with nothing to scroll, a jump could never move
 * anything. A host never configures it, and a tabbed or paned form reports no
 * sections, so it draws nothing there — a tabbed layout's own strip switches
 * the content.
 */
export function FormSectionNav({ items, className, onDrawnChange }: FormSectionNavProps) {
  const { t } = useSectionNavTranslation();
  const [current, setCurrent] = React.useState<string | undefined>(undefined);
  // While set, the jump a click started is under way: see CLICK_HOLD_MS.
  const holding = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // The section the last click jumped to, while the form stays at its bottom:
  // a short tail shows several headings at once and the click picks one.
  const jumpedTo = React.useRef<string | null>(null);
  // Re-reads the scroll position; bound by the scroll spy below.
  const remeasure = React.useRef<(() => void) | null>(null);
  // The heading a click marked, and the timer that clears its mark.
  const marked = React.useRef<{ heading: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearMark = React.useCallback(() => {
    if (!marked.current) return;
    clearTimeout(marked.current.timer);
    marked.current.heading.removeAttribute(JUMP_MARK_ATTR);
    marked.current = null;
  }, []);
  React.useEffect(() => () => {
    if (holding.current) clearTimeout(holding.current);
    clearMark();
  }, [clearMark]);
  const listed = items && items.length >= 2 ? items : null;
  const anchorIds = listed ? listed.map((i) => i.anchorId).join('\n') : '';

  // Whether the sections all fit their scroller, re-read whenever the scroller
  // or the form inside it changes size: a section unfolding, a field the
  // predicates reveal, the dialog maximized or the window resized.
  // A layout effect, so a dialog whose sections fit never paints the bar first.
  const [fits, setFits] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!anchorIds) return;
    const first = document.getElementById(anchorIds.split('\n')[0]);
    if (!first) return;
    const scroller = scrollParentOf(first);
    const check = () => setFits(contentFits(scroller));
    check();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    // The headings' parent is the form's field grid, which every section's
    // fields share: its height is the content's.
    if (first.parentElement) observer?.observe(first.parentElement);
    if (scroller) observer?.observe(scroller);
    else window.addEventListener('resize', check);
    return () => {
      observer?.disconnect();
      if (!scroller) window.removeEventListener('resize', check);
    };
  }, [anchorIds]);
  const shown = listed && !fits ? listed : null;

  const drawn = shown !== null;
  const reportDrawn = React.useRef(onDrawnChange);
  reportDrawn.current = onDrawnChange;
  React.useEffect(() => {
    reportDrawn.current?.(drawn);
  }, [drawn]);

  // Scroll spy: the current section is the last heading at or above the
  // scroller's top edge; at the very bottom it is the section a click jumped
  // to when its heading is in view, else the last section, whose heading may
  // never reach the top on a short tail.
  React.useEffect(() => {
    if (!anchorIds) return;
    const ids = anchorIds.split('\n');
    const keyByAnchor = new Map((listed ?? []).map((i) => [i.anchorId, i.key]));
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
    // `anchorIds` stands for `listed`: the listener only needs re-binding when
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
    const reveal = () => {
      const heading = document.getElementById(item.anchorId);
      if (!heading) return;
      scrollToHeading(heading);
      clearMark();
      heading.setAttribute(JUMP_MARK_ATTR, '');
      marked.current = { heading, timer: setTimeout(clearMark, JUMP_MARK_MS) };
    };
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
      className={cn('relative flex items-center gap-1.5 overflow-x-auto border-b border-border py-2', className)}
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
              'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Hash aria-hidden="true" className="h-3 w-3 shrink-0 opacity-60" />
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
