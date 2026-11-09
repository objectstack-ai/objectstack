// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Delete package dialog's list of what goes (objectstack#31025), drawn from
 * a {@link PackageRemovalState}; `packageRemovalContents.ts` says where each
 * figure is read from.
 */

import * as React from 'react';
import { t, tFormat, translateMetadataType, type SupportedLocale } from './i18n.js';
import type { PackageRemovalState } from './packageRemovalContents.js';

export function PackageRemovalSummary({
  state,
  draftCount,
  dropsTables,
  locale,
}: {
  state: PackageRemovalState | null;
  /** How many pending drafts the delete also removes. */
  draftCount: number;
  /** The author chose to drop the object tables with their records. */
  dropsTables: boolean;
  locale: SupportedLocale;
}) {
  if (!state) return null;
  const objects = state.status === 'ready' ? state.contents.objects : [];
  // Nothing is dropped from a package that holds no object; while the list is
  // read, or when it could not be read, the line stands.
  const showPermanent = dropsTables && !(state.status === 'ready' && objects.length === 0);
  return (
    <div className="grid gap-2 text-sm" data-testid="pkg-detail-delete-contents">
      <p className="font-medium">{t('engine.packages.detail.deleteContentsHeading', locale)}</p>
      {state.status === 'loading' && (
        <p className="text-xs text-muted-foreground" data-testid="pkg-detail-delete-contents-loading">
          {t('engine.packages.detail.deleteContentsLoading', locale)}
        </p>
      )}
      {state.status === 'failed' && (
        <p className="text-xs text-muted-foreground" data-testid="pkg-detail-delete-contents-failed">
          {t('engine.packages.detail.deleteContentsFailed', locale)}
        </p>
      )}
      {state.status === 'ready' && (
        <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2 text-xs">
          {objects.map((o) => (
            <li
              key={o.name}
              className="flex items-baseline justify-between gap-3"
              data-testid={`pkg-detail-delete-object-${o.name}`}
            >
              <span className="min-w-0 break-words">
                {o.label}
                {o.label !== o.name && <span className="ml-1 font-mono text-muted-foreground">{o.name}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {recordCountText(state.counts[o.name], locale)}
              </span>
            </li>
          ))}
          {state.contents.others.map((o) => (
            <li
              key={o.type}
              className="flex items-baseline justify-between gap-3"
              data-testid={`pkg-detail-delete-type-${o.type}`}
            >
              <span className="min-w-0 break-words">{translateMetadataType(o.type, locale)}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{o.count}</span>
            </li>
          ))}
          {objects.length === 0 && state.contents.others.length === 0 && (
            <li className="text-muted-foreground">{t('engine.packages.detail.deleteContentsEmpty', locale)}</li>
          )}
        </ul>
      )}
      {draftCount > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="pkg-detail-delete-drafts">
          {draftCount === 1
            ? tFormat('engine.packages.detail.deleteDraftsOne', locale, { count: draftCount })
            : tFormat('engine.packages.detail.deleteDraftsOther', locale, { count: draftCount })}
        </p>
      )}
      {showPermanent && (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
          data-testid="pkg-detail-delete-permanent"
        >
          {t('engine.packages.detail.deletePermanent', locale)}
        </p>
      )}
    </div>
  );
}

function recordCountText(count: number | null | undefined, locale: SupportedLocale): string {
  if (count === undefined) return '…';
  if (count === null) return t('engine.packages.detail.deleteRecordsUnknown', locale);
  return count === 1
    ? tFormat('engine.packages.detail.deleteRecordsOne', locale, { count })
    : tFormat('engine.packages.detail.deleteRecordsOther', locale, { count });
}
