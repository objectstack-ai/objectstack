/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ConcurrentUpdateDialog — Optimistic Concurrency Control conflict UX.
 *
 * Surfaced when a save races another writer and the server rejects with
 * `409 CONCURRENT_UPDATE`. Mirrors the pattern used by Jira / ServiceNow /
 * Dynamics 365: present the user with the freshest server value alongside
 * their pending edit, and let them choose how to resolve.
 *
 * The dialog is intentionally schema-agnostic: it shows the raw field
 * name plus before/after string previews. The caller is responsible for
 * supplying user-facing field labels and for actually performing the
 * "Reload" / "Overwrite" actions (the dialog just signals intent).
 */
"use client";

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  buttonVariants,
  cn,
} from '@object-ui/components';
import { AlertTriangle } from 'lucide-react';
import { useDisplayLocale } from '@object-ui/i18n';
import { useDetailTranslation } from './useDetailTranslation';

export interface ConcurrentUpdateConflict {
  /** Field machine name that the user tried to update. */
  field: string;
  /** User-facing label for the field. */
  label?: string;
  /** Value the user attempted to write. */
  pendingValue: unknown;
  /** Value currently on the server (may be undefined when unknown). */
  currentValue: unknown;
  /** Latest server-side `updated_at` token, useful for an "overwrite" retry. */
  currentVersion?: string;
  /** Full latest server record, when the backend included it in the 409. */
  currentRecord?: Record<string, unknown> | null;
}

export interface ConcurrentUpdateDialogProps {
  open: boolean;
  conflict: ConcurrentUpdateConflict | null;
  /** "Reload latest" — discard the user's pending edit and refetch. */
  onReload: () => void;
  /** "Overwrite anyway" — retry the save, re-keyed against currentVersion. */
  onOverwrite: () => void;
  /** "Cancel" — close the dialog and leave the form in its pre-save state. */
  onCancel: () => void;
  /** Whether an action is in flight (disables buttons). */
  busy?: boolean;
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.length > 0 ? value : '""';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatTimestamp = (raw: unknown, locale: string): string | null => {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // Backend ships SQL-style "YYYY-MM-DD HH:mm:ss.SSS"; normalise so Date parses it cross-browser.
  const iso = /\d{4}-\d{2}-\d{2}[ T]/.test(raw) ? raw.replace(' ', 'T') : raw;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    // The tag is DECLARED (objectui#9786) — a bare call formats in the
    // machine's locale, which is neither the tenant's nor the user's channel.
    return d.toLocaleString(locale);
  } catch {
    return d.toISOString();
  }
};

export const ConcurrentUpdateDialog: React.FC<ConcurrentUpdateDialogProps> = ({
  open,
  conflict,
  onReload,
  onOverwrite,
  onCancel,
  busy = false,
}) => {
  const { t } = useDetailTranslation();
  // The BCP-47 tag the racer's timestamp is formatted with (objectui#9786).
  const displayLocale = useDisplayLocale();
  const fieldLabel = conflict?.label || conflict?.field || '';
  const pendingPreview = conflict ? formatValue(conflict.pendingValue) : '';
  const currentPreview = conflict ? formatValue(conflict.currentValue) : '';

  // Audit metadata for the racer's write, when the server included currentRecord.
  const racer = (conflict?.currentRecord ?? {}) as Record<string, unknown>;
  const racerUpdatedBy = (() => {
    // Prefer a denormalised human-readable name when the backend supplies one
    // (e.g. `updated_by_name`). Avoid showing raw opaque IDs like
    // "pOxl94EamZD0…" — they confuse rather than inform the user.
    const candidates = [racer['updated_by_name'], racer['updated_by_label']];
    for (const v of candidates) {
      if (typeof v === 'string' && v.length > 0) return v;
    }
    const id = racer['updated_by'];
    if (typeof id !== 'string' || id.length === 0) return null;
    // Heuristic: looks like a long opaque token (no spaces, ≥16 chars,
    // mixed case alphanumerics) → suppress it.
    const looksLikeToken =
      id.length >= 16 && !/\s/.test(id) && /^[A-Za-z0-9_-]+$/.test(id);
    return looksLikeToken ? null : id;
  })();
  const racerUpdatedAt = formatTimestamp(racer['updated_at'] ?? conflict?.currentVersion, displayLocale);

  // Render the description with the field label bolded. We translate a string
  // that contains the literal placeholder "{{field}}" and split on it so we can
  // emit a React <strong> child without dangerouslySetInnerHTML.
  const descriptionTemplate = t('detail.concurrentUpdateDescription', { field: '{{field}}' });
  const [beforeField, afterField] = descriptionTemplate.split('{{field}}');

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <span
              className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
              aria-hidden="true"
            >
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <AlertDialogTitle>{t('detail.concurrentUpdateTitle')}</AlertDialogTitle>
              <AlertDialogDescription className="mt-1">
                {beforeField}
                <strong className="font-semibold">{fieldLabel}</strong>
                {afterField}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="space-y-2 text-sm">
          <div className="rounded-md border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
              {t('detail.concurrentUpdateYourEdit')}
            </div>
            <div className="mt-1 break-all font-mono text-foreground">{pendingPreview}</div>
          </div>
          <div className="rounded-md border border-sky-200/70 bg-sky-50/60 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-sky-800 dark:text-sky-300">
                {t('detail.concurrentUpdateCurrentValue')}
              </div>
              {(racerUpdatedBy || racerUpdatedAt) && (
                <div className="text-[11px] text-muted-foreground">
                  {racerUpdatedBy && (
                    <span>{t('detail.concurrentUpdateUpdatedBy', { name: racerUpdatedBy })}</span>
                  )}
                  {racerUpdatedBy && racerUpdatedAt && <span> · </span>}
                  {racerUpdatedAt && (
                    <span>{t('detail.concurrentUpdateUpdatedAt', { when: racerUpdatedAt })}</span>
                  )}
                </div>
              )}
            </div>
            <div className="mt-1 break-all font-mono text-foreground">{currentPreview}</div>
          </div>
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={cn(buttonVariants({ variant: 'ghost' }), 'mt-2 sm:mt-0')}
          >
            {t('detail.concurrentUpdateCancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onOverwrite}
            className={cn(buttonVariants({ variant: 'outline' }), 'mt-2 sm:mt-0 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive')}
          >
            {t('detail.concurrentUpdateOverwrite')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReload}
            autoFocus
            className={cn(buttonVariants({ variant: 'default' }), 'mt-2 sm:mt-0')}
          >
            {t('detail.concurrentUpdateReload')}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConcurrentUpdateDialog;

/**
 * Lightweight duck-typed check. Avoids a runtime dependency on
 * `@object-ui/data-objectstack` (and any other adapter that wants to
 * raise the same kind of error) while still recognising the canonical
 * shape: `code === 'CONCURRENT_UPDATE'` carrying optional
 * `currentVersion` / `currentRecord` fields.
 *
 * The second limb — `name === 'ConcurrentUpdateError'` — is the deliberate
 * cross-realm discriminator, and it stays: a host that bundles the adapter
 * twice makes `instanceof` fail, leaving the class name as the only thing
 * left to match on. The rationale is recorded above `isConcurrentUpdateError`
 * in `packages/data-objectstack/src/index.ts`.
 *
 * That limb is also why `code` is declared OPTIONAL below (objectui#6421). An
 * error matched by `name` alone carries no `code` at all, so promising
 * `code: 'CONCURRENT_UPDATE'` as a REQUIRED literal handed the caller a
 * property the value does not have: `err.code === 'CONCURRENT_UPDATE'` would
 * type-check and be `undefined` at runtime, with no compiler help. Declared =
 * enforced — the narrowed type states only what BOTH limbs guarantee, which
 * is the two optional payload fields its one consumer already reads. Pinned
 * by `__tests__/ConcurrentUpdateDialog.narrowedCode-6421.test.tsx`.
 */
export function isConcurrentUpdateError(err: unknown): err is {
  code?: 'CONCURRENT_UPDATE';
  currentVersion?: string;
  currentRecord?: Record<string, unknown> | null;
  message?: string;
} {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; name?: string };
  return e.code === 'CONCURRENT_UPDATE' || e.name === 'ConcurrentUpdateError';
}
