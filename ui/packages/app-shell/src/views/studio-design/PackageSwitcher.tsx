// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package helpers Studio's surface and its landing share: the
 * package-list toast id, the Studio landing path and the installed-row read.
 * The top-bar package switcher that lived here with them, since
 * objectstack#29988's move-only split, was removed by objectstack#36501: the
 * top bar's left end is 「‹ Back to app」 (`StudioBackToApp.tsx`), and a
 * package is picked in the app or on the Studio landing (`BuilderLanding`),
 * whose cards also open the management sheet.
 */

import type { InstalledPackageRow } from '../metadata-admin/PackagesPage.js';

/**
 * One sonner id for EVERY `fetchPackages()` failure on this surface
 * (objectui#7368). More than one effect calls that one endpoint on mount — the
 * writability courtesy gate and the namespace lookup — so a single 503 rejects
 * them all. Sonner UPDATES a toast that already carries the id instead of
 * stacking a new one (the `outcomeToastId` pattern this repo already uses in
 * `packages/components/src/renderers/form/form.tsx`), so one outage produces
 * one toast, not several. Reporting the failure is the point;
 * reporting it three times is noise that would get the report muted.
 */
export const PACKAGE_LIST_TOAST_ID = 'studio-package-list';

/** objectui#12513 — the Studio landing (`BuilderLanding`). */
export const STUDIO_LANDING_PATH = '/studio';

/**
 * The record the standard detail/management sheet opens on: a package's full
 * installed row (manifest + status), read from `GET /api/v1/packages`, since
 * the Studio landing holds only the trimmed {id,name,writable} view. `null` =
 * the list answered and does not name `id`; a failed read throws. Read by the
 * landing cards' Manage (objectstack#35196).
 */
export async function fetchInstalledPackageRow(id: string): Promise<InstalledPackageRow | null> {
  const res = await fetch('/api/v1/packages', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  /**
   * ⛔ `res.ok` is not optional here (objectui#7881). The platform answers a
   * failed read in the ADR-0112 envelope — `{ success: false, error: { code,
   * message } }` — and that envelope PARSES CLEANLY through the reader
   * below: `root` becomes the error object, which is neither an array nor
   * carries `packages`, so `list` fell to `[]` and `.find()` to `null`.
   * Nothing threw, `openManage`'s catch never ran, and the management sheet
   * was opened on a null package. An empty list is a completely legitimate
   * SUCCESS answer, so using it for a failure is representing failure with a
   * legitimate success value — the same family as objectui#7368 and
   * objectui#7821 (PR #7879), one seam over.
   *
   * Measured on this path, not assumed. `GET /api/v1/packages` is served by
   * the direct-mount registrar (`@objectstack/rest` `package-routes.ts`,
   * which mounts FIRST in the production stack), and `check:route-envelope`
   * pins that module at zero hand-written bodies: every failure leaves
   * through the shared `sendError` / `sendThrownError`. The reachable
   * failures are `401 UNAUTHENTICATED` (anonymous deny), `403 FORBIDDEN`
   * (the `studio.access` / `setup.access` capability gate), `503
   * SERVICE_UNAVAILABLE` (either half of the two-source merge refusing a
   * read it could not perform) and `500 INTERNAL_ERROR` — one shape,
   * `{ success: false, error: { code, message } }`, pinned wire-side by
   * `package-envelope.conformance.test.ts`.
   *
   * So the envelope's own `success` is NOT a second bit to read here: `sendOk`
   * writes `true` on every 2xx and the error writers write `false` on every
   * non-2xx, which makes it `!res.ok` restated. `res.ok` is the DECISION; the
   * envelope is read for the WORDS, which is the half that needs it — in the
   * 5xx band the platform withholds the producer's prose and answers the
   * generic `Internal server error`, leaving `error.code` as the only
   * discriminating word, so the code travels with the message.
   *
   * The one other shape a browser can meet is a non-JSON error body (a
   * proxy's HTML 502/504). `res.json()` rejects on it — which the caller
   * already reported, as a JSON syntax error — so the tolerant read below
   * names the status instead.
   */
  if (!res.ok) {
    const failure = (await res.json().catch(() => null)) as {
      error?: { code?: unknown; message?: unknown; userMessage?: unknown };
    } | null;
    /**
     * ⭐ `userMessage` OUTRANKS `message`, and the order is the contract's,
     * not a preference (objectui#7938).
     *
     * `error.userMessage` is the producer's channel (objectstack `79c46da90`),
     * and the envelope writer's own words are the rule this line implements:
     * "the text a producer marked, AT THROW TIME, as addressed to the END USER.
     * Presence IS the marking — a consumer that sees the field renders it
     * verbatim and keeps its generic substitution for everything unmarked"
     * (`sendError`, `@objectstack/types` `response-envelope.ts`). This
     * reader was that consumer and did not see the field: it read
     * `error.message` and `error.code` and stopped, so a marked sentence
     * arrived on the wire and had nowhere to appear.
     *
     * The 5xx band is where the loss became visible rather than merely
     * theoretical. That door withholds the producer's PROSE and substitutes
     * the generic `Internal server error` into `error.message` — but the
     * withhold rewrites a local `message` const and `looksLikeInternalErrorLeak`
     * is only ever handed `thrown.message`, so `userMessage` is never an
     * input to it and rides through untouched (`sendThrownError`,
     * `@objectstack/rest` `package-routes.ts`; pinned wire-side by
     * `package-door-user-message.test.ts`). So on a marked 500/503 this
     * reader showed the author the generic sentence and dropped the
     * specific one written for them — nothing invalid displayed, which is
     * exactly what made it quiet.
     *
     * ⛔ NOT scoped to 5xx, deliberately. The marked channel is
     * status-agnostic by the producing door's own ruling — "a marked text is
     * the producer's deliberate statement to the caller at any status" — so
     * a consumer that honoured it only in one band would re-create, on the
     * reading end, precisely the divergence that door refused to create on
     * the writing end. A 4xx `message` is already caller-facing by design;
     * when a producer ALSO marked a text there, the mark is the more
     * specific answer to "what should this person read", and the diagnostic
     * it displaces is not lost to diagnosis — `code` still travels below.
     *
     * ⛔ Not a tolerant alias ladder either: these are two DECLARED fields
     * with different meanings, not two spellings of one. An unmarked refusal
     * carries no `userMessage` at all (the producer's `declaredUserMessage`
     * already applied its non-empty-string rule), so the overwhelmingly
     * common case falls straight through to `message` with byte-identical
     * output.
     */
    const marked = typeof failure?.error?.userMessage === 'string' ? failure.error.userMessage : '';
    const diagnostic = typeof failure?.error?.message === 'string' ? failure.error.message : '';
    const message = marked || diagnostic;
    const code = typeof failure?.error?.code === 'string' ? failure.error.code : '';
    throw new Error(message ? (code ? `${message} (${code})` : message) : `HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  const root = (data as { data?: unknown })?.data ?? data;
  const list = (Array.isArray(root) ? root : ((root as { packages?: unknown[] })?.packages ?? [])) as Array<
    InstalledPackageRow & { id?: string }
  >;
  return list.find((p) => (p?.manifest?.id ?? p?.id) === id) ?? null;
}
