// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The whole-package actions of the Packages page's development face, in one
 * place, so every surface that offers one runs the same code (objectstack#37139):
 *
 *   - the development face's detail sheet (`PackageDetailSheet` in
 *     `PackagesPage.tsx`), where they were written;
 *   - Studio's 「⋯」 package menu beside the app or package name
 *     (`studio-design/StudioPackageMenu.tsx`).
 *
 * What lives here is each action's REQUEST and its DIALOG or FORM; where the
 * answer is shown (the sheet's message line, Studio's toast) stays with the
 * surface. ⛔ A surface that offers one of these actions imports it from here;
 * it never writes a second copy.
 */

import * as React from 'react';
import { Copy } from 'lucide-react';
import {
  Button,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@object-ui/components';
import { createAuthenticatedFetch } from '@object-ui/auth';
import type { ReassignOrphanedMetadataResponse } from '@objectstack/spec/api';
import { t, tFormat } from './i18n.js';
import { PackageFormDialog } from './PackageFormDialog.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import { forgetPackageListReads, isSpecPackageId } from '../studio-design/packages-io.js';
import { PackageIdInput } from '../studio-design/PackageIdInput.js';
import type { InstalledPackageRow, PackageManifestRow } from './PackagesPage.js';

/* -------------------------------------------------------------------------- */
/* The package REST surface                                                    */
/* -------------------------------------------------------------------------- */

export const PACKAGES_API = '/api/v1/packages';

/** The console's authenticated fetch: the stored bearer token beside the session cookie. */
function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return createAuthenticatedFetch()(input, init);
}

/**
 * One `/api/v1/packages` request, read the Packages page's way: the answer's
 * `data` (or the bare object), or an `Error` carrying the refusal's sentence,
 * `code` and `details`.
 */
export async function packagesApiJson<T>(path: string, init?: RequestInit): Promise<T> {
  // objectstack#29119 — every write this page sends (publish, revert, discard,
  // delete, adopt, enable/disable, import) may change the package list, so the
  // list reads from before it are forgotten however it ends, the session's
  // held list the app → Studio entries read included.
  const writes = (init?.method ?? 'GET').toUpperCase() !== 'GET';
  const res = await authFetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
    ...init,
  }).finally(() => {
    if (writes) forgetPackageListReads();
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok || payload?.success === false) {
    // The ADR-0112 envelope first, by the ONE shared rule — a producer-marked
    // `error.userMessage` outranks the diagnostic `error.message`, and
    // `error.code` rides along behind whichever won. This helper used to read
    // `error.message` and stop, so a marked sentence arrived on the wire (both
    // doors serving these package routes emit the channel) and had nowhere to
    // appear. See {@link readEnvelopeFailureText}.
    //
    // The two rungs BELOW it stay, and stay here rather than moving into the
    // shared reader: they are not the ADR-0112 envelope. A bare-string `error`
    // and a top-level `message` are older runtimes' shapes, live for this page
    // and not for the Studio readers, and folding them in would have handed
    // every other consumer of the rule a tolerant dialect it never asked for.
    const msg =
      readEnvelopeFailureText(payload) ||
      payload?.error ||
      payload?.message ||
      `Request failed (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : `Request failed (${res.status})`) as Error & {
      code?: string;
      details?: unknown;
    };
    // ADR-0141 D2 — the envelope's `code` and `details` ride on the error, so a
    // caller that draws a refusal from its facts (`DEPENDENCY_MISSING` at the
    // import door) can; every other caller reads the message as before.
    if (typeof payload?.error?.code === 'string') err.code = payload.error.code;
    if (payload?.error?.details !== undefined) err.details = payload.error.details;
    throw err;
  }
  // Runtime wraps successful payloads in { data, ... } or returns the object directly.
  return (payload?.data ?? payload) as T;
}

/* -------------------------------------------------------------------------- */
/* The actions' requests                                                       */
/* -------------------------------------------------------------------------- */

const packagePath = (id: string, door = '') => `${PACKAGES_API}/${encodeURIComponent(id)}${door}`;

/**
 * Revert: `POST /packages/:id/revert`, the package back to its last published
 * state (the stored members' drafts dropped; a never-published package is
 * refused by the server).
 */
export function revertPackage(id: string): Promise<unknown> {
  return packagesApiJson(packagePath(id, '/revert'), { method: 'POST' });
}

/**
 * Export: the package as the export door serves it, downloaded as
 * `<id>.package.json` — the file Import takes back.
 */
export async function exportPackageFile(id: string): Promise<void> {
  const manifest = await packagesApiJson<unknown>(packagePath(id, '/export'));
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.package.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * ADR-0070 D5 — adopt every package-less (loose) item in this environment INTO
 * the package. Answers the server's own count, `reassignedCount`
 * (`ReassignOrphanedMetadataResponse`), 0 included: the answer's own `success`
 * is false exactly when nothing moved, which on this door is a count of 0, not
 * a failure, so the count is what the author is told.
 */
export async function adoptLooseItems(id: string): Promise<number> {
  const r = await packagesApiJson<ReassignOrphanedMetadataResponse>(packagePath(id, '/adopt-orphans'), {
    method: 'POST',
  });
  return r.reassignedCount;
}

/** The answer to an adoption, in the author's language. */
export function adoptedText(count: number, locale: string): string {
  return tFormat(count === 1 ? 'engine.packages.detail.adoptedOne' : 'engine.packages.detail.adoptedOther', locale, {
    count,
  });
}

/* -------------------------------------------------------------------------- */
/* The actions' dialogs and forms                                              */
/* -------------------------------------------------------------------------- */

/**
 * EditPackageDialog — thin wrapper over the spec-driven {@link PackageFormDialog}
 * in `edit` mode. The manifest form locks `id` / `type` / `namespace` / scope
 * as immutable and submits only name / description / version / dependencies —
 * all the REST `PATCH /api/v1/packages/:id` persists. Only the row's manifest
 * is read, so a surface holding the listed manifest alone (Studio's menu) opens
 * it the same way the detail sheet does.
 */
export function EditPackageDialog({
  pkg,
  open,
  onOpenChange,
  onSaved,
}: {
  pkg: { manifest: PackageManifestRow } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (updated: InstalledPackageRow) => void;
}) {
  return (
    <PackageFormDialog
      mode="edit"
      open={open}
      onOpenChange={onOpenChange}
      manifest={pkg?.manifest ?? null}
      onSaved={(r) => onSaved((r.package as unknown as InstalledPackageRow) ?? (pkg as InstalledPackageRow))}
    />
  );
}

/**
 * The in-app confirmation *Adopt loose items* asks first (objectui#13339): only
 * its confirm adopts, and its Cancel sends nothing.
 */
export function AdoptLooseItemsDialog({
  open,
  onOpenChange,
  displayName,
  onConfirm,
  locale,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The package's name, as its surface's title shows it. */
  displayName: string;
  onConfirm: () => void;
  locale: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="pkg-detail-adopt-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{tFormat('engine.packages.detail.adoptTitle', locale, { name: displayName })}</AlertDialogTitle>
          <AlertDialogDescription>{t('engine.packages.detail.adoptDescription', locale)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="pkg-detail-adopt-cancel">{t('engine.cancel', locale)}</AlertDialogCancel>
          <AlertDialogAction data-testid="pkg-detail-adopt-confirm" onClick={onConfirm}>
            {t('engine.packages.detail.adoptOrphans', locale)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * ADR-0070 D4 — the Duplicate form (objectui#11784): the new package's name and
 * id, the same id input (`PackageIdInput`) and the same id rule
 * (`isSpecPackageId`, objectui#11855) the create dialog and the duplicate route
 * judge by. It opens on 「Copy of NAME」 and `<id>-copy`; mounting it again
 * starts it again. It asks; `onDuplicate` sends (`duplicatePackage`).
 */
export function DuplicatePackageForm({
  sourceId,
  displayName,
  busy,
  duplicating,
  onDuplicate,
  onCancel,
  locale,
}: {
  sourceId: string;
  displayName: string;
  /** An action is running: the form sends nothing more. */
  busy: boolean;
  /** The running action is this form's duplicate. */
  duplicating: boolean;
  onDuplicate: (targetId: string, targetName: string) => void;
  onCancel: () => void;
  locale: string;
}) {
  const [name, setName] = React.useState(() =>
    tFormat('engine.studio.landing.dupDefaultName', locale, { name: displayName }),
  );
  const [targetId, setTargetId] = React.useState(() => `${sourceId}-copy`);
  const armed = name.trim().length > 0 && isSpecPackageId(targetId.trim());
  const go = () => {
    if (armed && !busy) onDuplicate(targetId.trim(), name.trim());
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-2.5" data-testid="pkg-detail-dup-form">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={t('engine.studio.landing.dupNamePlaceholder', locale)}
        aria-label={t('engine.studio.landing.dupNamePlaceholder', locale)}
        data-testid="pkg-detail-dup-name-input"
        className="h-7 w-full rounded-md border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-primary"
      />
      <PackageIdInput
        value={targetId}
        onChange={setTargetId}
        onEnter={go}
        onEscape={onCancel}
        placeholder={t('engine.studio.landing.dupIdPlaceholder', locale)}
        locale={locale}
        testId="pkg-detail-dup-id-input"
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={go} disabled={busy || !armed}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          {duplicating ? t('engine.packages.detail.duplicating', locale) : t('engine.packages.detail.duplicateGo', locale)}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          {t('engine.cancel', locale)}
        </Button>
      </div>
    </div>
  );
}
