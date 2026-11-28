/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record's top bar (objectstack#27524, Target 7): ONE bar at the top of the
 * record on every face — the page, the split pane, the drawer over a list or a
 * page, the maximized pane, the phone.
 *
 * Two rows when the host hands the record row (`record`, objectstack#35853,
 * figure 40), the page and the drawer alike:
 *
 * 1. The navigation row, 40 px (`data-record-top-bar-nav`). Left: ✕ first
 *    (`close`, the leftmost control of the row on every two-row face), then
 *    what the host hands as `leading` (one level down in a pane 「← 路径」, or
 *    the object's name when the record came from no list), then ↑ ↓ and
 *    「第 N 条，共 M 条 · 视图名」 (`stepper`, a list context; the view's name
 *    returns to that list). Right: the frame controls (`frame`: ⤢ in a
 *    drawer). No record name, no actions.
 * 2. The record row, 48 px (`data-record-top-bar-record`): the record's icon,
 *    name and tags (`record`, where the record header portals its title), and
 *    at the right the record's button group (`actionSlotRef`, hidden while
 *    empty) and the panel switches (`toggles`, the right column's ⊟).
 *
 * Without `record` it is the one-row bar it was (objectstack#35593), 44 px —
 * the phone's: left `leading`, right the counter 「3 / 21」 and ↓ ↑, the
 * button group, the panel switches, the frame controls, then `close` last.
 *
 * Pure presentation: every control's handler, and whether it applies, belong to
 * the host — `NavigationOverlay` draws it as the pane's bar, the console's
 * record view as the page's.
 */

import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { createSafeTranslation } from '@object-ui/i18n';
import { cn } from '../lib/utils';

/**
 * English defaults for the bar's own strings. The probe key `common.close` is
 * in all ten packs, so a mounted `I18nProvider` always resolves it and the real
 * `t` is used; with no provider every key falls back to its English default.
 */
const TOP_BAR_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'common.close': 'Close',
  'detail.previousRecord': 'Previous record',
  'detail.nextRecord': 'Next record',
  'detail.recordOf': '{{current}} of {{total}}',
  'detail.recordOfScope': '{{current}} of {{total}} in {{scope}}',
};

const useTopBarTranslation = createSafeTranslation(TOP_BAR_DEFAULT_TRANSLATIONS, 'common.close');

/**
 * The bar's icon-button face, shared by every control on it. Below `sm` a
 * control is a 44 px touch target, and the bar grows to hold it
 * (objectstack#29071).
 */
const RECORD_TOP_BAR_BUTTON_CLASS =
  'inline-flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

/** The list context the bar steps through: the counter and ↓ ↑. */
export interface RecordTopBarStepper {
  /** The previous record of the set; absent at its start, which draws ↑ disabled. */
  onPrevious?: () => void;
  /** The next record of the set; absent at its end, which draws ↓ disabled. */
  onNext?: () => void;
  /**
   * Where the record sits in the set — `index` from 0 — for the counter
   * 「3 / 21」. Absent, or outside the set: no counter, the pair alone.
   */
  position?: { index: number; total: number };
  /** The set's name (the list view it came from), which the counter says. */
  scope?: string;
  /**
   * Return to the list the set came from (objectstack#35853): the two-row
   * bar draws `scope` as a link that calls it. Absent, the name is text.
   */
  onScope?: () => void;
}

export interface RecordTopBarProps {
  /** The left end, after `close` on the two-row bar: the breadcrumb, or 「← 路径」. */
  leading?: React.ReactNode;
  /** `data-testid` of the left end, for a host that addresses it. */
  leadingTestId?: string;
  /** The counter and ↓ ↑, drawn only with a list context. */
  stepper?: RecordTopBarStepper;
  /**
   * The record's button group (objectstack#35593): handed the element the
   * record header portals its actions into, after the step group. The element
   * and the hairline after it are hidden while nothing is drawn there.
   */
  actionSlotRef?: React.Ref<HTMLSpanElement>;
  /** The panel switches (the right column's ⊟), after the step group. */
  toggles?: React.ReactNode;
  /**
   * The record's comment switch (objectstack#36075): the comments icon and its
   * count, drawn before the record's button group. A host that hands nothing
   * (feeds off, a page with its own discussion) draws nothing there.
   */
  comments?: React.ReactNode;
  /** The frame controls — ⤢ (a drawer) — at the right end. */
  frame?: React.ReactNode;
  /**
   * ✕, which closes the record: the first control of the two-row bar's
   * navigation row, before `leading`; the one-row bar draws it last, after
   * `frame`.
   */
  close?: React.ReactNode;
  /**
   * The record row (objectstack#35853): the record's icon, name and tags, or
   * the slot the record header portals them into. Handed, the bar is two
   * rows; absent, one.
   */
  record?: React.ReactNode;
  className?: string;
}

/** One icon control of the bar: its label is its accessible name and its tooltip. */
export const RecordTopBarButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(({ label, title, className, type, ...rest }, ref) => (
  <button
    ref={ref}
    type={type ?? 'button'}
    aria-label={label}
    title={title ?? label}
    className={cn(RECORD_TOP_BAR_BUTTON_CLASS, className)}
    {...rest}
  />
));
RecordTopBarButton.displayName = 'RecordTopBarButton';

/**
 * Whether a key event belongs to the element it was typed in rather than to
 * the bar's step shortcuts: a text field, an editable region, or a composite
 * widget that already moves with the arrow keys (a menu, a list box, a grid,
 * a tab strip).
 */
function keyEventOwnedByTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    return true;
  }
  return !!target.closest(
    '[role="menu"], [role="menubar"], [role="listbox"], [role="combobox"], [role="grid"], [role="treegrid"], [role="tree"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="spinbutton"]',
  );
}

/**
 * The hosts whose step keys are live, the latest last. Only the latest one
 * steps: a pane opened over a record page owns `j` / `k` while it is open,
 * and the page gets them back when it closes.
 */
const stepKeyOwners: object[] = [];

/**
 * The bar's previous / next shortcuts (objectstack#26679): `k` and `j`, and
 * with `arrows` (the pane's default) `ArrowUp` and `ArrowDown` too — on the
 * document while `active`, never with a modifier and never while the event
 * belongs to its target ({@link keyEventOwnedByTarget}). The page passes
 * `arrows: false`: there the arrow keys scroll the page.
 *
 * An active host with no `stepper` (a record with no set) still holds the
 * keys from the hosts under it, and lets them through to its own body.
 */
export function useRecordStepKeys(
  active: boolean,
  stepper: RecordTopBarStepper | undefined,
  { arrows = true }: { arrows?: boolean } = {},
) {
  const latest = React.useRef(stepper);
  latest.current = stepper;
  React.useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const owner = {};
    stepKeyOwners.push(owner);
    const onKeyDown = (e: KeyboardEvent) => {
      if (stepKeyOwners[stepKeyOwners.length - 1] !== owner || !latest.current) return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (keyEventOwnedByTarget(e.target)) return;
      let step: (() => void) | undefined;
      if ((arrows && e.key === 'ArrowUp') || e.key === 'k') step = latest.current.onPrevious;
      else if ((arrows && e.key === 'ArrowDown') || e.key === 'j') step = latest.current.onNext;
      else return;
      // The key is the bar's even at an end of the set, so the body does
      // not scroll under a disabled control.
      e.preventDefault();
      step?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const at = stepKeyOwners.indexOf(owner);
      if (at >= 0) stepKeyOwners.splice(at, 1);
    };
  }, [active, arrows]);
}

/**
 * The record's top bar (objectstack#27524, Target 7). See the module doc for
 * the anatomy; `data-record-top-bar` marks it on every face.
 */
export function RecordTopBar({ leading, leadingTestId, stepper, actionSlotRef, toggles, comments, frame, close, record, className }: RecordTopBarProps) {
  const { t } = useTopBarTranslation();
  const position =
    stepper?.position && stepper.position.total > 0 && stepper.position.index >= 0 && stepper.position.index < stepper.position.total
      ? { current: stepper.position.index + 1, total: stepper.position.total }
      : undefined;
  const positionLabel = position
    ? stepper?.scope
      ? t('detail.recordOfScope', { ...position, scope: stepper.scope })
      : t('detail.recordOf', position)
    : undefined;
  const previousLabel = t('detail.previousRecord');
  const nextLabel = t('detail.nextRecord');
  const previousButton = stepper ? (
    <RecordTopBarButton
      label={previousLabel}
      title={`${previousLabel} · K`}
      aria-keyshortcuts="K"
      onClick={stepper.onPrevious}
      disabled={!stepper.onPrevious}
      data-record-top-bar-step="previous"
    >
      <ChevronUp className="h-3.5 w-3.5" />
    </RecordTopBarButton>
  ) : null;
  const nextButton = stepper ? (
    <RecordTopBarButton
      label={nextLabel}
      title={`${nextLabel} · J`}
      aria-keyshortcuts="J"
      onClick={stepper.onNext}
      disabled={!stepper.onNext}
      data-record-top-bar-step="next"
    >
      <ChevronDown className="h-3.5 w-3.5" />
    </RecordTopBarButton>
  ) : null;
  if (record !== undefined) {
    const scope = stepper?.scope;
    return (
      <div className={cn('flex min-w-0 shrink-0 flex-col border-b', className)} data-record-top-bar="" data-record-top-bar-rows="2">
        <div
          className="flex min-h-10 sm:h-10 sm:min-h-0 min-w-0 items-center justify-between gap-2 px-2 text-xs text-muted-foreground"
          data-record-top-bar-nav=""
        >
          {close !== undefined && (
            <div className="flex shrink-0 items-center" data-record-top-bar-close="">
              {close}
            </div>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1" data-record-top-bar-leading="" data-testid={leadingTestId}>
            {leading}
            {stepper && (
              <span className="flex min-w-0 items-center gap-0.5" data-record-top-bar-stepper="">
                {previousButton}
                {nextButton}
                {position && (
                  <span className="ml-1 flex min-w-0 items-center gap-1 whitespace-nowrap">
                    <span className="tabular-nums" title={positionLabel} aria-label={positionLabel} data-record-top-bar-position="">
                      {t('detail.recordOf', position)}
                    </span>
                    {scope && (
                      <>
                        <span aria-hidden="true">·</span>
                        {stepper.onScope ? (
                          <button
                            type="button"
                            onClick={stepper.onScope}
                            className="min-w-0 truncate rounded px-0.5 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            data-record-top-bar-scope=""
                          >
                            {scope}
                          </button>
                        ) : (
                          <span className="min-w-0 truncate" data-record-top-bar-scope="">{scope}</span>
                        )}
                      </>
                    )}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5" data-record-top-bar-frame="">
            {frame}
          </div>
        </div>
        <div
          className="flex min-h-12 min-w-0 items-center justify-between gap-3 px-3 pb-1"
          data-record-top-bar-record=""
        >
          <div className="flex min-w-32 flex-1 items-center gap-2 overflow-hidden" data-record-top-bar-title="">
            {record}
          </div>
          <div className="flex min-w-0 shrink items-center justify-end gap-0.5" data-record-top-bar-controls="">
            {comments}
            {actionSlotRef && (
              <>
                <span
                  ref={actionSlotRef}
                  className="peer/actions flex min-w-0 items-center justify-end gap-2 text-sm text-foreground empty:hidden"
                  data-record-top-bar-actions=""
                />
                {/* Hidden beside no actions, and beside a host's toggle slot
                    that holds nothing (a drawer with no panel switch). */}
                {toggles && (
                  <span
                    aria-hidden="true"
                    className="mx-1.5 h-4 w-px shrink-0 bg-border peer-empty/actions:hidden [&:has(+:empty)]:hidden"
                    data-record-top-bar-divider="actions"
                  />
                )}
              </>
            )}
            {toggles}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex min-h-11 sm:h-11 sm:min-h-0 min-w-0 shrink-0 items-center justify-between gap-2 border-b px-2 text-xs text-muted-foreground',
        className,
      )}
      data-record-top-bar=""
    >
      <div className="flex min-w-0 flex-1 items-center gap-1" data-record-top-bar-leading="" data-testid={leadingTestId}>
        {leading}
      </div>
      <div className="flex shrink-0 items-center gap-0.5" data-record-top-bar-controls="">
        {stepper && (
          <>
            {position && (
              <span
                className="mr-1 tabular-nums"
                title={positionLabel}
                aria-label={positionLabel}
                data-record-top-bar-position=""
              >
                {position.current} / {position.total}
              </span>
            )}
            {nextButton}
            {previousButton}
            {(actionSlotRef || toggles || frame || close) && (
              <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-border" data-record-top-bar-divider="" />
            )}
          </>
        )}
        {comments}
        {actionSlotRef && (
          <>
            <span
              ref={actionSlotRef}
              className="peer/actions flex shrink-0 items-center gap-2 text-sm text-foreground empty:hidden"
              data-record-top-bar-actions=""
            />
            {(toggles || frame || close) && (
              <span
                aria-hidden="true"
                className="mx-1.5 h-4 w-px bg-border peer-empty/actions:hidden"
                data-record-top-bar-divider="actions"
              />
            )}
          </>
        )}
        {toggles}
        {frame}
        {close}
      </div>
    </div>
  );
}
