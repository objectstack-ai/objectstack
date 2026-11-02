// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console's one customization mark (objectstack ADR-0146 D3, "On top, one
 * surface"): the chip that says an item of an installed base is customized,
 * naming the base, or added by the base's paired `<base>.custom` package. The
 * All metadata area's lists draw it; the pillar rails (N-19) reuse it, so a
 * customization reads the same wherever it is listed.
 *
 * Which row carries which mark is `customizationMarks.ts`'s rule, from the
 * base's served customization read only. {@link usePackageCustomizations} is
 * that read for one base, in the four states the pages draw: off (no base to
 * read), loading, failed (with the server's sentence) and read. ⛔ A loading
 * or failed read draws no mark and no number, never a "0".
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { customizationPackageId } from '@objectstack/spec/kernel';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { fetchListedPackageManifests } from './packages-io.js';
import { fetchPackageCustomizations, type PackageCustomizations } from './packageCustomizations-io.js';
import { indexCustomizations, type CustomizationMarkIndex, type CustomizationMarkKind } from './customizationMarks.js';

/**
 * The marks the component draws: a list's two ({@link CustomizationMarkKind}),
 * and `customizationOf`, which labels an item of a pair with its base where
 * no base is open (the cross-package leg).
 */
export type CustomizationMarkChipKind = CustomizationMarkKind | 'customizationOf';

const KIND_CLASS: Record<CustomizationMarkChipKind, string> = {
  customized: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  added: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  customizationOf: 'bg-muted text-muted-foreground',
};

export function CustomizationMark({
  kind,
  baseName,
  pairId,
  locale,
  className,
}: {
  kind: CustomizationMarkChipKind;
  /** The base's display name ("customized (HotCRM)"); needed by `customized` and `customizationOf`. */
  baseName?: string;
  /** The pair's id, named in the chip's title. */
  pairId?: string;
  locale: string;
  className?: string;
}): React.ReactElement {
  const base = baseName ?? '';
  const label =
    kind === 'added'
      ? t('engine.customizationMark.added', locale)
      : tFormat(`engine.customizationMark.${kind}`, locale, { baseName: base });
  const title = pairId
    ? tFormat(`engine.customizationMark.${kind}Title`, locale, { baseName: base, pair: pairId })
    : undefined;
  return (
    <span
      data-testid="customization-mark"
      data-kind={kind}
      title={title}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-[5px] px-1.5 text-[11px] font-medium',
        KIND_CLASS[kind],
        className,
      )}
    >
      {label}
    </span>
  );
}

/** One base's customization read, as the pages draw it. */
export type PackageCustomizationsState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | {
      status: 'read';
      read: PackageCustomizations;
      index: CustomizationMarkIndex;
      /** The base's listed name, else its id. */
      baseName: string;
    };

/**
 * Read `baseId`'s customizations, or nothing (`off`) when `baseId` is `null` or
 * derives no pair: a customization package itself has none to read, and the
 * route refuses its id.
 *
 * The base's name comes from the package list the area already reads (one
 * request, `packages-io.ts`); when that list cannot name it, the id stands in.
 *
 * `refresh` (objectstack#28572): read again whenever it moves (Studio's
 * publish, which is what changes the served overrides). A re-read keeps the
 * last answer for the same base until it lands, so the marks do not blink.
 */
export function usePackageCustomizations(baseId: string | null, refresh: unknown = 0): PackageCustomizationsState {
  const readable = baseId !== null && customizationPackageId(baseId).ok;
  const [answer, setAnswer] = React.useState<{ id: string; state: PackageCustomizationsState } | null>(null);
  React.useEffect(() => {
    if (!readable || baseId === null) return;
    let cancelled = false;
    const name = fetchListedPackageManifests().then(
      (manifests) => manifests.get(baseId)?.name ?? baseId,
      () => baseId,
    );
    Promise.all([fetchPackageCustomizations(baseId), name]).then(
      ([read, baseName]) => {
        if (cancelled) return;
        const index = indexCustomizations(baseId, read);
        setAnswer({ id: baseId, state: index ? { status: 'read', read, index, baseName } : { status: 'off' } });
      },
      (err: unknown) => {
        if (cancelled) return;
        setAnswer({ id: baseId, state: { status: 'failed', message: err instanceof Error ? err.message : String(err) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [baseId, readable, refresh]);
  if (!readable) return { status: 'off' };
  return answer?.id === baseId ? answer.state : { status: 'loading' };
}
