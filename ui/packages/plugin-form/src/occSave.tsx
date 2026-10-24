/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * occSave — Optimistic Concurrency Control for the record edit forms.
 *
 * Every form variant (ObjectForm / ModalForm / DrawerForm / TabbedForm /
 * SplitForm / WizardForm) reads the record with `findOne` and later writes it
 * back with `dataSource.update`. Without a version token that write is
 * last-write-wins: two users editing the same record both get a 200 and the
 * later save silently erases the earlier one. The server already supports
 * conditional writes (`If-Match: <updated_at>` → `409 CONCURRENT_UPDATE`), and
 * the DataSource contract forwards it via `update(..., { ifMatch })` — the
 * forms were the only link in the chain not sending it.
 *
 * `useOccSave` centralises the guarded write:
 *   1. `update` is issued with `ifMatch` = the `updated_at` the form read —
 *      or, once this hook has itself saved that record, the version its last
 *      successful write returned (objectui#10565; see `versionToSend`).
 *   2. On `409 CONCURRENT_UPDATE` a dialog offers **Keep editing** (stay in
 *      the form, draft intact) or **Overwrite** (retry re-keyed to the
 *      server's `currentVersion` — "I know it changed, mine wins").
 *
 * Records without a string `updated_at` (older backends, objects without
 * timestamps) degrade gracefully: no token is sent and behaviour is unchanged.
 * The richer reload-and-compare resolution lives in the record page's inline
 * edit (`plugin-detail`'s ConcurrentUpdateDialog); a modal form has no server
 * rendering of its own to reload into, so it keeps the choice binary.
 */

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
import { createSafeTranslation, useDisplayLocale } from '@object-ui/i18n';
import { declaredUserMessage } from '@object-ui/react';

// Localized strings for the conflict dialog. Falls back to English when no
// i18n provider is mounted (createSafeTranslation handles that).
const useOccTranslation = createSafeTranslation(
  {
    'form.conflictTitle': 'Save conflict',
    'form.conflictMessage':
      'This record was changed by someone else while you were editing. '
      + 'Overwriting will replace their changes with yours.',
    'form.conflictLatestVersion': 'Their save: {{time}}',
    'form.conflictOverwrite': 'Overwrite',
    'form.keepEditing': 'Keep editing',
  },
  'form.conflictTitle',
);

/**
 * The OCC token for a record the form previously read: its `updated_at`.
 * Anything non-string (missing column, pre-OCC backend) yields `undefined`,
 * which downgrades the write to unguarded — exactly the old behaviour.
 */
export function occVersionOf(record: unknown): string | undefined {
  const v = (record as Record<string, unknown> | null | undefined)?.updated_at;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Duck-typed detection of the platform's 409 CONCURRENT_UPDATE, matching
 * `@object-ui/data-objectstack`'s `ConcurrentUpdateError` without depending on
 * that adapter (plugin-form is adapter-agnostic; a custom DataSource may throw
 * its own error object with the same wire `code`).
 */
export function isConcurrentUpdateError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  return e.code === 'CONCURRENT_UPDATE' || e.name === 'ConcurrentUpdateError';
}

export type OccSaveOutcome =
  /** The write landed (guarded, or deliberately overwritten). */
  | { status: 'saved'; result: any }
  /** The user chose to keep editing after a conflict — nothing was written. */
  | { status: 'cancelled' };

export interface OccSaveArgs {
  dataSource: any;
  objectName: string;
  recordId: string | number;
  payload: Record<string, any>;
  /**
   * The record as the form read it (`findOne` result) — supplies the
   * `updated_at` version token. Optional: without it the write is unguarded.
   * It decides WHETHER the write is guarded; after this hook's own save of
   * the same record it no longer decides WHICH version is sent (see
   * `versionToSend`).
   */
  baseRecord?: unknown;
}

/**
 * What this hook remembers about its last successful write to one record.
 */
interface WrittenVersion {
  /** `occVersionOf(baseRecord)` when that write was made: the read it superseded. */
  readVersion: string;
  /** `occVersionOf(result)`: the version that write returned. */
  version: string;
}

/** One key per record, so a save to one record never carries another's version. */
function recordKey(objectName: string, recordId: string | number): string {
  return JSON.stringify([objectName, String(recordId)]);
}

/**
 * The `ifMatch` a save sends (objectui#10565).
 *
 * The forms hand in the record they READ as `baseRecord`, and a form that
 * stays open after a save still holds that read. Its `updated_at` stops being
 * current the moment this hook's own write lands: the server stamps a new one
 * and returns it with the saved record. Sending the read's token again made
 * the second save from a form that stays open answer `409 CONCURRENT_UPDATE`,
 * and the user met the conflict dialog over their own earlier save. That was
 * measured once against a real ObjectStack stack; the reading is on
 * objectui#10565 and nothing in this package re-derives it. The pins in
 * `occSave.secondSave.test.tsx` hold this rule against a double shaped like
 * that measurement.
 *
 * So once a write through this hook has landed, the version it returned is
 * sent instead, but only while the form still holds the SAME read. A
 * `baseRecord` with a different token is a newer read of the record (a
 * reload), and its token wins over anything remembered. With no token on
 * the read the save stays unguarded exactly as before: this changes which
 * version a guarded save sends, never whether a save is guarded.
 */
function versionToSend(
  written: WrittenVersion | undefined,
  readVersion: string | undefined,
): string | undefined {
  if (!readVersion) return undefined;
  return written && written.readVersion === readVersion ? written.version : readVersion;
}

interface ConflictState {
  /** Latest server-side version from the 409, for the overwrite retry. */
  currentVersion?: string;
  /**
   * The refusal text the PRODUCER marked as addressed to the end user
   * (`userMessage`, objectstack `79c46da90`), or `undefined` when the 409 carried no
   * marking. Read through `declaredUserMessage`, never duck-typed here: the
   * marking lands in two different places depending on which error the adapter
   * built (a typed member on `ConcurrentUpdateError`, the details bag on
   * `DataApiValidationError`), and that reader is the one place that knows both.
   */
  userMessage?: string;
}

/**
 * Backend ships SQL-style "YYYY-MM-DD HH:mm:ss.SSS"; normalise for Date.
 *
 * `locale` is REQUIRED: the conflict dialog shows this time to the person
 * deciding whether to overwrite, and the version without it formatted in the
 * MACHINE's locale (objectui#9909). The hook below passes `useDisplayLocale()`.
 */
function formatVersionTime(raw: string | undefined, locale: string): string | null {
  if (!raw) return null;
  const iso = /\d{4}-\d{2}-\d{2}[ T]/.test(raw) ? raw.replace(' ', 'T') : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(locale);
}

/**
 * OCC-guarded record update for the form variants.
 *
 * Returns `{ saveWithOcc, conflictDialog }`: call `saveWithOcc` where the
 * variant issued its raw `dataSource.update`, and render `conflictDialog`
 * anywhere in the variant's tree (it portals). A `cancelled` outcome means the
 * user kept editing — skip the success path and leave the form open.
 */
export function useOccSave(): {
  saveWithOcc: (args: OccSaveArgs) => Promise<OccSaveOutcome>;
  conflictDialog: React.ReactNode;
} {
  const { t } = useOccTranslation();
  const displayLocale = useDisplayLocale();
  const [conflict, setConflict] = React.useState<ConflictState | null>(null);
  // Resolver for the promise `saveWithOcc` awaits while the dialog is open.
  const decisionRef = React.useRef<((overwrite: boolean) => void) | null>(null);
  // Per record, the version this hook's last successful write returned
  // (objectui#10565). It lives exactly as long as the form that mounted this
  // hook; a remounted form reads the record again.
  const writtenRef = React.useRef(new Map<string, WrittenVersion>());

  const settle = React.useCallback((overwrite: boolean) => {
    decisionRef.current?.(overwrite);
    decisionRef.current = null;
    setConflict(null);
  }, []);

  // If the host unmounts mid-conflict (modal torn down), resolve as
  // "keep editing" so the awaiting submit never hangs.
  React.useEffect(() => () => decisionRef.current?.(false), []);

  const saveWithOcc = React.useCallback(
    async ({ dataSource, objectName, recordId, payload, baseRecord }: OccSaveArgs): Promise<OccSaveOutcome> => {
      const key = recordKey(objectName, recordId);
      const readVersion = occVersionOf(baseRecord);
      const ifMatch = versionToSend(writtenRef.current.get(key), readVersion);
      // After a write lands, remember the version it returned for the next
      // save of this record. A result without one clears the entry, so that
      // save falls back to the read's token rather than to an older write's.
      const remember = (result: unknown) => {
        const version = occVersionOf(result);
        if (readVersion && version) writtenRef.current.set(key, { readVersion, version });
        else writtenRef.current.delete(key);
      };
      try {
        const result = await dataSource.update(
          objectName, recordId, payload, ifMatch ? { ifMatch } : undefined,
        );
        remember(result);
        return { status: 'saved', result };
      } catch (err) {
        if (!isConcurrentUpdateError(err)) throw err;
        const currentVersion = (err as { currentVersion?: unknown }).currentVersion;
        // A 409 an author MARKED says something this dialog's canned copy
        // cannot — which record, which team, what to do next. It used to be
        // dropped here, so every conflict read identically no matter what the
        // producer wrote (objectui#5902, inheriting objectui#5210's ruling).
        // Everything unmarked still answers `null`, so objectstack#3821's
        // protection is untouched.
        const marked = declaredUserMessage(err);
        const overwrite = await new Promise<boolean>((resolve) => {
          decisionRef.current = resolve;
          setConflict({
            currentVersion: typeof currentVersion === 'string' ? currentVersion : undefined,
            userMessage: marked ?? undefined,
          });
        });
        if (!overwrite) return { status: 'cancelled' };
        // Re-key against the version the 409 reported: "apply my payload on
        // top of the record I now know about". Without one, fall back to an
        // unguarded write — the user explicitly chose to win.
        const cv = typeof currentVersion === 'string' && currentVersion.length > 0
          ? currentVersion
          : undefined;
        const result = await dataSource.update(
          objectName, recordId, payload, cv ? { ifMatch: cv } : undefined,
        );
        // The overwrite is a write like any other: the next save sends the
        // version it returned, not the stale read and not the 409's version.
        remember(result);
        return { status: 'saved', result };
      }
    },
    [],
  );

  const latestTime = formatVersionTime(conflict?.currentVersion, displayLocale);

  const conflictDialog = (
    <AlertDialog open={!!conflict} onOpenChange={(open) => { if (!open) settle(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
            {t('form.conflictTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {/*
              The producer's marking leads, in its own right — and does NOT
              replace the sentence under it. That sentence does two jobs in one
              paragraph: it says why the write was refused, AND it explains what
              the destructive button will do. `userMessage` is a refusal
              message, not affordance copy this surface owns, so evicting the
              paragraph would leave "Overwrite" unexplained on the one surface
              where the choice is irreversible. Rendered verbatim: the author
              already wrote and localized it for their user.
            */}
            {conflict?.userMessage && (
              <span className="mb-2 block font-medium text-foreground">
                {conflict.userMessage}
              </span>
            )}
            {t('form.conflictMessage')}
            {latestTime && (
              <span className="mt-2 block text-xs text-muted-foreground">
                {t('form.conflictLatestVersion', { time: latestTime })}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <button
            type="button"
            className={cn(buttonVariants({ variant: 'outline' }))}
            onClick={() => settle(false)}
          >
            {t('form.keepEditing')}
          </button>
          <button
            type="button"
            className={cn(buttonVariants({ variant: 'destructive' }))}
            onClick={() => settle(true)}
          >
            {t('form.conflictOverwrite')}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { saveWithOcc, conflictDialog };
}
