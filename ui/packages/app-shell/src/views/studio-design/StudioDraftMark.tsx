// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (item 3) — the copilot's draft marks on Studio's properties:
 * the 草稿 chip on a field or a view setting the AI copilot changed, and the
 * 来源 line 「由 AI 副驾在 N 分钟前作为草稿加入」, as the StudioRailProps
 * artboard draws them.
 *
 * ## What they read
 *
 * The pending draft's per-key provenance, `draftChanges`, which the strict
 * draft read serves beside `item` (objectstack#24298, written by
 * objectstack#24395): one `{ path, by, actor, at }` per changed key path. The
 * entry that answers for a key is the one `governingDraftChange` finds (the
 * longest prefix, `@object-ui/data-objectstack`, the one reader of it).
 *
 * ## When a mark is drawn
 *
 * Only for `by: 'copilot'`. A key whose answering entry is `studio` (a person
 * in Studio) or `api` (any other caller) draws nothing, and so does a draft
 * whose read recorded no `draftChanges` at all (absent is "not recorded").
 * Besides the answering entry, an entry UNDER the key counts too: the copilot
 * changing one property of a published field records `["fields", NAME,
 * "label"]`, which no ancestor of `["fields", NAME]` answers for, and that
 * field is still one the copilot changed.
 *
 * The marks describe the draft as it was READ: a later edit made here is
 * attributed by the framework on save and shows from the next read.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { draftChangesUnder, governingDraftChange, type DraftChange } from '@object-ui/data-objectstack';
import { isZhLocale, t, tFormat } from '../metadata-admin/i18n.js';

/** The copilot's mark on one key: when the copilot last changed it. */
export interface CopilotDraftMark {
  at: string;
}

/**
 * The copilot's mark on the key at `path`, or `null` when no copilot write
 * answers for it — see the module docblock. With several copilot entries (the
 * key's own and some under it), the latest `at` is the one the 来源 line reads.
 */
export function copilotDraftMarkOf(
  changes: readonly DraftChange[] | null | undefined,
  path: readonly string[],
): CopilotDraftMark | null {
  let latest: DraftChange | null = null;
  for (const change of [governingDraftChange(changes, path), ...draftChangesUnder(changes, path)]) {
    if (!change || change.by !== 'copilot') continue;
    if (!latest || Date.parse(change.at) > Date.parse(latest.at)) latest = change;
  }
  return latest ? { at: latest.at } : null;
}

/**
 * The elements of `draft` that `published` does not hold: the elements of an
 * array setting the draft added. An array is one leaf of `draftChanges` (its
 * path never carries an index), so which elements are new is read by comparing
 * the two arrays, as the spec prescribes. Elements compare by value.
 */
export function addedArrayElements(draft: unknown, published: unknown): unknown[] {
  if (!Array.isArray(draft)) return [];
  const before = new Set((Array.isArray(published) ? published : []).map((v) => JSON.stringify(v)));
  return draft.filter((v) => !before.has(JSON.stringify(v)));
}

/** Whole minutes from `at` to `now`; never negative (a clock a little ahead). */
function minutesSince(at: string, now: number): number {
  const ms = now - Date.parse(at);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}

/** "N 分钟前" / "N min ago", in the largest whole unit; `null` under a minute. */
function agoText(at: string, locale: string, now: number): string | null {
  const minutes = minutesSince(at, now);
  if (minutes < 1) return null;
  if (minutes < 60) return tFormat('engine.studio.draftMark.minutesAgo', locale, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tFormat('engine.studio.draftMark.hoursAgo', locale, { n: hours });
  return tFormat('engine.studio.draftMark.daysAgo', locale, { n: Math.floor(hours / 24) });
}

/**
 * The 来源 sentence: 「由 AI 副驾在 2 分钟前作为草稿加入」, or, naming the
 * added elements of an array setting, 「「读者」「应还日期」 2 项由 AI 副驾在 2
 * 分钟前作为草稿加入」.
 */
export function draftSourceText(
  at: string,
  locale: string,
  items: readonly string[] = [],
  now: number = Date.now(),
): string {
  const ago = agoText(at, locale, now);
  if (items.length === 0) {
    return ago
      ? tFormat('engine.studio.draftMark.source', locale, { when: ago })
      : t('engine.studio.draftMark.sourceJustNow', locale);
  }
  const named = items
    .map((label) => tFormat('engine.studio.draftMark.item', locale, { label }))
    .join(isZhLocale(locale) ? '' : ', ');
  const vars = { items: named, count: items.length };
  return ago
    ? tFormat('engine.studio.draftMark.sourceItems', locale, { ...vars, when: ago })
    : tFormat('engine.studio.draftMark.sourceItemsJustNow', locale, vars);
}

/** The 草稿 chip. */
export function DraftChip({ locale, className, testId = 'studio-draft-chip', of }: {
  locale: string;
  className?: string;
  testId?: string;
  /** What the chip marks (a setting's name, or an added element's value), as `data-draft-of`. */
  of?: string;
}): React.ReactElement {
  return (
    <span
      data-testid={testId}
      data-draft-of={of}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center rounded-[5px] bg-emerald-100 px-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
        className,
      )}
    >
      {t('engine.studio.draftMark.chip', locale)}
    </span>
  );
}

/** The 来源 block: its label, then the sentence ({@link draftSourceText}). */
export function DraftSourceLine({ at, locale, items, className, testId = 'studio-draft-source' }: {
  at: string;
  locale: string;
  items?: readonly string[];
  className?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} className={cn('space-y-1', className)}>
      <p className="text-xs font-medium text-muted-foreground">{t('engine.studio.draftMark.sourceLabel', locale)}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{draftSourceText(at, locale, items)}</p>
    </div>
  );
}
