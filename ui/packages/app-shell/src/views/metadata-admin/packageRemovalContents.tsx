// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the Delete package dialog states will go (objectstack#31025): each
 * object the package holds with its row count, every other item counted by
 * type, and the pending drafts.
 *
 * Read from two doors that already exist, never a route of its own:
 *  - `GET /api/v1/packages/:id/export` — the package's published items, one
 *    collection key per metadata type (`PackageExportManifestSchema`). It does
 *    not carry a package's datasources or email templates.
 *  - the data list with `$top: 0` — `total` is the number of rows the caller
 *    can read, the same count the object list's footer shows.
 *
 * A count the data list did not answer is drawn as unknown, never as `0`.
 */

import * as React from 'react';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '@objectstack/spec/ui';
import { t, tFormat, translateMetadataType, type SupportedLocale } from './i18n.js';

export interface PackageRemovalContents {
  /** The objects the package holds, in the export's order. */
  objects: Array<{ name: string; label: string }>;
  /** Every other published item, counted by its singular metadata type. */
  others: Array<{ type: string; count: number }>;
}

/**
 * The export's one declared member that is a list but not a metadata
 * collection: the positions of maps it withheld from connectors.
 */
const NOT_A_COLLECTION = 'withheldMaps';

/** Reads the export door's answer into what the dialog lists. */
export function readPackageRemovalContents(manifest: unknown): PackageRemovalContents {
  const objects: PackageRemovalContents['objects'] = [];
  const byType = new Map<string, number>();
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { objects, others: [] };
  for (const [key, value] of Object.entries(manifest as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length === 0 || key === NOT_A_COLLECTION) continue;
    // `viewItems` carries the views the `views` containers do not re-derive:
    // both are views of the package.
    const type = key === ASSEMBLED_VIEW_ITEMS_KEY ? 'view' : canonicalMetaUrlType(key);
    if (type === 'object') {
      for (const item of value) {
        const name = typeof item?.name === 'string' ? item.name : '';
        if (!name) continue;
        objects.push({ name, label: typeof item.label === 'string' && item.label ? item.label : name });
      }
      continue;
    }
    byType.set(type, (byType.get(type) ?? 0) + value.length);
  }
  return { objects, others: [...byType].map(([type, count]) => ({ type, count })) };
}

/**
 * The dialog's state for the list: still reading, the read failed, or the
 * contents with each object's count (`undefined` while it is read, `null`
 * when the data list gave none).
 */
export type PackageRemovalState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; contents: PackageRemovalContents; counts: Record<string, number | null | undefined> };

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
