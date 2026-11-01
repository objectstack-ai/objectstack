// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28572 (ADR-0146 D3, "On top, one surface") — the pieces every
 * Studio pillar rail uses to show a read-only base and its paired
 * `<base>.custom` package as one list:
 *
 *  - {@link withPairItems}: the base's rows, then each row of the pair whose
 *    name the base's list does not hold, stamped `addedIn: <pair>`. A row of
 *    the pair that overrides a base item is served IN the base's list, under
 *    the base's name (ADR-0146 D8 item 2), so it is the base's row here;
 *  - {@link railCustomizationsOf}: which mark a row carries, from the base's
 *    served customization read (N-15) and the row's own package, by the one
 *    rule `customizationMarks.ts` holds. ⛔ Nothing is computed from the
 *    documents: no diff against the base;
 *  - {@link RailCustomizationFilter}: the rail's "only customizations"
 *    toggle, from the same read;
 *  - {@link StudioPairItemChip}: the item header's naming of the pair an
 *    added item lives in (D3: "the item header … say[s] where the item
 *    went").
 *
 * An added row opens writable on the base's surface: it reads and saves at
 * the pair its row was listed in (the listed pair, or the one the ensure door
 * answered), never at a `<base>.custom` id spelled here. A New on a read-only
 * base asks the ensure door for the pair first (`StudioBaseCustomization`).
 *
 * Items another package contributes to the base (fields extending its
 * objects, flows on its objects, ADR-0029 D7 navigation entries) are not
 * drawn: no served read names the contributing package (objectstack#28722),
 * and the rail derives none.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { Boxes } from 'lucide-react';
import { customizationBasePackageId } from '@objectstack/spec/kernel';
import { tFormat } from '../metadata-admin/i18n.js';
import { CustomizationMark, type PackageCustomizationsState } from './CustomizationMark.js';
import { customizationMarkOf, type CustomizationMarkKind } from './customizationMarks.js';

/** A rail row as the one-surface helpers read it. */
export interface PairRailRow {
  type: string;
  name: string;
  /** The pair this row is an item of, when the base does not hold its name (an item the pair adds). */
  addedIn?: string;
}

/**
 * The base's rows, then the pair's rows the base's list does not name, each
 * stamped `addedIn: pairId`. Order: the base's order, then the pair's.
 * `pairRows` empty (no pair, or its read failed) returns the base's rows as
 * they are.
 */
export function withPairItems<T extends { name: string }>(
  baseRows: readonly T[],
  pairRows: readonly T[],
  pairId: string | null,
): Array<T & { addedIn?: string }> {
  if (pairId === null || pairRows.length === 0) return [...baseRows];
  const held = new Set(baseRows.map((r) => r.name));
  const added = pairRows.filter((r) => r.name && !held.has(r.name)).map((r) => ({ ...r, addedIn: pairId }));
  return [...baseRows, ...added];
}

/** What a rail draws of the base's customizations. */
export interface RailCustomizations {
  /** The mark a row carries, or `null`. */
  markOf(row: PairRailRow): CustomizationMarkKind | null;
  /** The base's display name, for the mark's text. */
  baseName: string;
  /** The base's pair id, for the mark's title. */
  pairId: string;
  /** The read's failure sentence, or `null`. */
  failed: string | null;
}

/**
 * The marks of a base's rail, or `null` when there is nothing to mark: no
 * read (`state` null or `off`) or a read still in flight. A failed read marks
 * nothing and carries the server's sentence. The row's package is its
 * `addedIn` pair, else the base: a base row the read lists is "customized",
 * an added row "added", every other row nothing.
 */
export function railCustomizationsOf(
  state: PackageCustomizationsState | null | undefined,
  base: string,
): RailCustomizations | null {
  if (!state || state.status === 'off' || state.status === 'loading') return null;
  if (state.status === 'failed') {
    return { markOf: () => null, baseName: base, pairId: '', failed: state.message };
  }
  const { index, baseName } = state;
  return {
    markOf: (row) =>
      customizationMarkOf({ type: row.type, name: row.name, packageId: row.addedIn ?? base }, index),
    baseName,
    pairId: index.pairId,
    failed: null,
  };
}

/** A row's mark in the rail's trailing slot, or nothing. */
export function RailCustomizationMark({
  row,
  marks,
  locale,
}: {
  row: PairRailRow;
  marks: RailCustomizations | null;
  locale: string;
}): React.ReactElement | null {
  const kind = marks?.markOf(row) ?? null;
  if (kind === null || !marks) return null;
  return (
    <CustomizationMark
      kind={kind}
      baseName={marks.baseName}
      pairId={marks.pairId}
      locale={locale}
      className="ml-1"
    />
  );
}

/**
 * The rail's "only customizations (n)" toggle, under its heading. Drawn once
 * the read has answered and some row of the rail carries a mark, and kept
 * while it is on (so it can be turned off after the last mark goes). A failed
 * read shows its sentence instead, and no toggle.
 */
export function RailCustomizationFilter({
  marks,
  marked,
  on,
  onToggle,
  locale,
  testId = 'studio-rail-customizations-only',
}: {
  marks: RailCustomizations | null;
  /** How many of the rail's rows carry a mark. */
  marked: number;
  on: boolean;
  onToggle: () => void;
  locale: string;
  testId?: string;
}): React.ReactElement | null {
  if (!marks) return null;
  if (marks.failed !== null) {
    return (
      <p data-testid="studio-rail-customizations-failed" className="px-3 pb-2 text-[11px] text-destructive">
        {tFormat('engine.customizationMark.readFailed', locale, { message: marks.failed })}
      </p>
    );
  }
  if (marked === 0 && !on) return null;
  return (
    <div className="shrink-0 px-3 pb-2">
      <button
        type="button"
        data-testid={testId}
        aria-pressed={on}
        onClick={onToggle}
        className={cn(
          'inline-flex h-6 items-center rounded-md border px-2 text-[11px]',
          on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {tFormat('engine.list.customizations.only', locale, { marked })}
      </button>
    </div>
  );
}

/** The item header's chip for an item the pair adds: it names the pair (ADR-0146 D3). */
export function StudioPairItemChip({ pairId, locale }: { pairId: string; locale: string }): React.ReactElement {
  return (
    <span
      data-testid="studio-pair-item-chip"
      title={tFormat('engine.studio.customize.addedInTitle', locale, { pair: pairId })}
      className="inline-flex h-[22px] max-w-[240px] shrink-0 items-center gap-1 rounded-[5px] bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
    >
      <Boxes className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{tFormat('engine.studio.customize.addedIn', locale, { pair: pairId })}</span>
    </span>
  );
}

/** The rail's state for "only customizations": on or off, per pillar. */
export function useRailCustomizationsOnly(): [boolean, () => void] {
  const [on, setOn] = React.useState(false);
  const toggle = React.useCallback(() => setOn((v) => !v), []);
  return [on, toggle];
}

/**
 * The package switcher's rows with each base's pair folded under it (ADR-0146
 * D3: "the package switcher folds `hotcrm.custom` under HotCRM instead of
 * giving it a row"): a row whose id is a pair (`customizationBasePackageId`)
 * of a base the list also holds has no row of its own; `pairOf` names it by
 * its base. A pair whose base is not listed keeps its row.
 */
export function foldCustomizationPairs<T extends { id: string }>(
  rows: readonly T[],
): { rows: T[]; pairOf: ReadonlyMap<string, T> } {
  const ids = new Set(rows.map((r) => r.id));
  const pairOf = new Map<string, T>();
  const out: T[] = [];
  for (const row of rows) {
    const base = customizationBasePackageId(row.id);
    if (base !== null && ids.has(base)) {
      pairOf.set(base, row);
      continue;
    }
    out.push(row);
  }
  return { rows: out, pairOf };
}

/**
 * The base a Studio pillar URL of a pair lands on (ADR-0146 D3: the pair has
 * no surface of its own), or `null` for any other package. By the spec's
 * pairing rule alone: a pair exists only beside its installed base (the ensure
 * door creates it for one, and the base cannot be uninstalled while it
 * exists).
 */
export function customizationPairBaseOf(packageId: string | null): string | null {
  return packageId === null ? null : customizationBasePackageId(packageId);
}
