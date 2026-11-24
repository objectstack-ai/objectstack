// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28573 (ADR-0146 D6) — "New similar" on a read-only base's
 * permission set: what the strip above the set says once the clone door
 * answered, and the navigation state the copy's landing rides on. Moved out
 * of the Access pillar unchanged (objectstack#36905), so the set's full-screen
 * page and the pillar say the same thing.
 */

import * as React from 'react';
import { Copy } from 'lucide-react';
import { permissionSetCloneNoticeText, type PermissionSetCloned } from '../metadata-admin/permission-set-clone.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { studioMetadataItemAddress } from './studioAddress.js';

/**
 * What the strip says: the copy the clone door saved (shown on that copy, in
 * the package the answer named), or an answer that cannot be opened (no copy
 * named, or no package). `notice` is the server's sentence, and `noticeCode`
 * the code it names it by (objectstack#29727): shown in the console's language
 * for a known code, as sent otherwise.
 */
export type NewSimilarStrip =
  | { kind: 'landed'; name: string; package: string; notice: string; noticeCode?: string }
  | { kind: 'noPackage'; name: string; notice: string; noticeCode?: string }
  | { kind: 'noName'; notice: string; noticeCode?: string };

/** The navigation-state key the copy's landing rides to the copy's page on. */
export const NEW_SIMILAR_ARRIVAL_STATE = 'accessNewSimilar';

/**
 * The landing a "New similar" navigation carried, for the page it opened:
 * kept only when it names THIS package, so a stale history entry of another
 * package's page shows nothing.
 */
export function readNewSimilarArrival(state: unknown, packageId: string): NewSimilarStrip | null {
  const arrival = (state as Record<string, unknown> | null | undefined)?.[NEW_SIMILAR_ARRIVAL_STATE] as
    | Partial<Extract<NewSimilarStrip, { kind: 'landed' }>>
    | undefined;
  if (!arrival || arrival.kind !== 'landed' || arrival.package !== packageId || typeof arrival.name !== 'string') {
    return null;
  }
  return {
    kind: 'landed',
    name: arrival.name,
    package: packageId,
    notice: typeof arrival.notice === 'string' ? arrival.notice : '',
    ...(typeof arrival.noticeCode === 'string' ? { noticeCode: arrival.noticeCode } : {}),
  };
}

/**
 * What a clone door's answer does: open the copy where it says the copy
 * landed — its metadata address, with the strip riding the navigation — or,
 * for an answer that names no copy or no package, say so where the person is.
 * The landing is never derived from the source.
 */
export function newSimilarOutcome(
  copy: PermissionSetCloned,
): { open: { to: string; state: Record<string, NewSimilarStrip> } } | { strip: NewSimilarStrip } {
  if (!copy.name) return { strip: { kind: 'noName', notice: copy.notice, noticeCode: copy.noticeCode } };
  if (typeof copy.package !== 'string') {
    return { strip: { kind: 'noPackage', name: copy.name, notice: copy.notice, noticeCode: copy.noticeCode } };
  }
  const landed: NewSimilarStrip = {
    kind: 'landed',
    name: copy.name,
    package: copy.package,
    notice: copy.notice,
    noticeCode: copy.noticeCode,
  };
  return {
    open: {
      to: studioMetadataItemAddress(copy.package, 'permission', copy.name, {
        query: `package=${encodeURIComponent(copy.package)}`,
      }),
      state: { [NEW_SIMILAR_ARRIVAL_STATE]: landed },
    },
  };
}

/** The strip itself. */
export function NewSimilarStripNotice({
  strip,
  locale,
  onDismiss,
}: {
  strip: NewSimilarStrip;
  locale: string;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div
      role={strip.kind === 'landed' ? 'status' : 'alert'}
      data-testid="access-new-similar-strip"
      className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <Copy className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p>
          {strip.kind === 'landed'
            ? tFormat('engine.studio.access.newSimilar.done', locale, { name: strip.name, package: strip.package })
            : strip.kind === 'noPackage'
              ? tFormat('engine.studio.access.newSimilar.noPackage', locale, { name: strip.name })
              : t('perm.clone.noName', locale)}
        </p>
        {/* objectstack#29727 — in the console's language for its known code, else as sent. */}
        {strip.notice && (
          <p>
            {permissionSetCloneNoticeText(
              {
                notice: strip.notice,
                noticeCode: strip.noticeCode,
                package: strip.kind === 'landed' ? strip.package : null,
              },
              locale,
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md px-1.5 text-[12px] hover:bg-amber-100 dark:hover:bg-amber-900/40"
      >
        {t('engine.studio.access.newSimilar.dismiss', locale)}
      </button>
    </div>
  );
}
