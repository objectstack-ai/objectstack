// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package-list helpers shared by the Studio package switcher and the builder
 * landing page.
 *
 * Writability is the SERVER's verdict, not a shape we derive. Every row of
 * `GET /api/v1/packages` carries a top-level `writable: boolean` computed by
 * `isWritablePackage` (ADR-0070 D2, objectstack#14375) — the same predicate the
 * server's authoring (`saveMetaItem`) and lifecycle (`DELETE` / `disable`) gates
 * enforce, so the badge and the gate cannot disagree. Read it; do not re-derive
 * it.
 *
 * The `scope !== 'project'` expression below is ONLY the fallback for servers
 * that predate that field, and it is WRONG for one row: a `type: module`
 * sub-package of a multi-package artifact (ADR-0130 D4) normally omits `scope`
 * — the schema default is applied at PARSE time, while the artifact load path
 * deliberately hands the RAW manifest body to `registerApp`, so the served row
 * has no `scope` key at all. The heuristic reads that as a writable database
 * base, yet the server refuses every write to it (it is in `engine.manifests`).
 * Nothing in the raw row separates it from a scope-less Studio-created base,
 * which really is writable — only the server's `engine.manifests` does, which is
 * why the client cannot compute this and a "missing scope means read-only" rule
 * would have flipped every Studio base read-only.
 *
 * Kernel packages (scope `system` / `cloud`) are hidden here whatever their
 * verdict says: that filter is about visibility, not writability.
 */

import { ManifestSchema, deriveNamespaceFromPackageId, validateObjectNamespacePrefix } from '@objectstack/spec/kernel';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';

export interface PkgEntry {
  id: string;
  /**
   * The package's HUMAN name — what the Studio top bar shows the author.
   *
   * Falls back to the id, which is what the switcher renders when the producer
   * declared no name at all. That fallback is the honest degradation; reading
   * the name from only ONE of the two shapes this endpoint serves was not
   * (objectui#7254) — see {@link parsePackages}.
   */
  name: string;
  writable: boolean;
  /**
   * The package's object-name namespace (framework#2694): every object in the
   * package must be named `<namespace>_*`. An explicit `manifest.namespace`
   * wins; otherwise it is back-derived from the id (same rule the kernel uses),
   * so authoring surfaces can prefix object names before publish rejects them.
   */
  namespace: string | null;
}

/**
 * `GET /api/v1/packages` merges TWO producers into one array, and they carry
 * their fields in two different positions:
 *
 *  - the durable half (`PackageService.list()`, published artifacts) nests
 *    everything under `manifest`;
 *  - the registry half (`protocol.getMetaItems({ type: 'package' })`) hands
 *    back the package METADATA DOCUMENT, whose fields are top-level.
 *
 * That is not an inference: the server's own list handler reads
 * `item.manifest?.id || item.id` on BOTH halves, i.e. the producer declares
 * both positions for the same field. This reader already matched it for `id`
 * — and only for `id`. `name` was read as `manifest.name ?? id`, so every
 * registry-shaped entry lost its human name and the Studio top bar showed the
 * reverse-domain package id (`app.b2r4`) where the author expected the app's
 * name (objectui#7254). Closing the asymmetry inside the one reader that
 * already declares both positions — not a new tolerant dialect.
 *
 * `writable` reads only the TOP level, and that is not the same asymmetry: it
 * is the server's own computed verdict (see the module doc), a field the
 * manifest does not and should not carry.
 *
 * `scope` is deliberately left manifest-only: widening it would change which
 * packages the switcher HIDES, which is a different question from what it
 * NAMES and is not this card's.
 */
export function parsePackages(payload: unknown): PkgEntry[] {
  const root = (payload as { data?: unknown })?.data ?? payload;
  const raw = Array.isArray(root) ? root : ((root as { packages?: unknown[] })?.packages ?? []);
  const out: PkgEntry[] = [];
  for (const p of raw as Array<Record<string, unknown>>) {
    if (!p || typeof p !== 'object') continue;
    const m = (p.manifest ?? {}) as Record<string, unknown>;
    const id = String(m.id ?? p.id ?? '');
    if (!id) continue;
    const scope = typeof m.scope === 'string' ? m.scope : '';
    if (scope === 'system' || scope === 'cloud') continue; // kernel — not app packages
    const namespace =
      typeof m.namespace === 'string' && m.namespace ? m.namespace : deriveNamespaceFromPackageId(id);
    // Server first, heuristic only when the key is absent (see the module doc).
    // A non-boolean value is not a verdict, so it falls back too.
    const writable = typeof p.writable === 'boolean' ? p.writable : scope !== 'project';
    // Same two positions as `id` above, same order (objectui#7254). An empty
    // string is not a name — it falls through to the id like an absent one.
    const declaredName =
      (typeof m.name === 'string' && m.name.trim() ? m.name : undefined) ??
      (typeof p.name === 'string' && p.name.trim() ? p.name : undefined);
    out.push({ id, name: declaredName ?? id, writable, namespace });
  }
  return out;
}

/**
 * The package list every Studio surface reads — the switcher, the writability
 * courtesy gate, the namespace lookup and the builder landing page.
 *
 * ## The failure arm used to discard the whole answer
 *
 * It was `if (!res.ok) throw new Error(\`HTTP ${res.status}\`)`: the body was
 * never opened at all, so `message`, `code` and `userMessage` were dropped
 * together and the status became the entire report. Every caller here reports
 * through `formatMetadataError`, which renders `err.message` — so a 403 whose
 * envelope said `Reading packages requires the \`studio.access\` or
 * \`setup.access\` capability.` reached the author as the four characters
 * `HTTP 403`, and the one sentence that named the capability to grant was
 * discarded by the reader that was holding it.
 *
 * This is a strictly larger loss than the sibling `fetchFullPackage` lookup's
 * (objectui#7938), which at least read `message` and `code`. Both now read the
 * same envelope by the same rule — see {@link readEnvelopeFailureText} for the
 * rule and for why the mark outranks the diagnostic at every status.
 *
 * ⛔ The fallback stays `HTTP <status>`, unchanged and deliberately so: it is
 * what a body-less or unparseable failure (a proxy's HTML 502) still says, and
 * `StudioDesignSurface.packageListErrorPosture` / `manageSnapshotRefresh` pin
 * that the three-state switcher and the refresh report keep working when the
 * wire answers with nothing readable.
 *
 * Concurrent callers share one request — see {@link readPackagesPayload}.
 */
export async function fetchPackages(): Promise<PkgEntry[]> {
  return parsePackages(await readPackagesPayload());
}

/**
 * The `GET /api/v1/packages` request currently on the wire, per `fetch`
 * (objectui#11797).
 *
 * Opening a package mounts three readers at once — the switcher list, the
 * writability courtesy gate and the namespace lookup — and each one sent its
 * own request, so the same list crossed the wire three times in one
 * navigation. A caller that arrives while a request is pending now waits for
 * that request instead of sending another.
 *
 * ⛔ Not a response cache, deliberately:
 *  - the entry goes the moment the request settles, so a call made after an
 *    answer always reaches the network. There is no reuse window because no
 *    client-side list can name every write that changes the package list (an
 *    agent creates packages server-side), and a window would answer the read
 *    after such a write with the list from before it;
 *  - a failure reaches the callers already waiting and is then forgotten;
 *  - the writes this module can see drop the pending request — its own
 *    `duplicatePackage` and the `objectui:packages-changed` announcement — so
 *    a read asked after either is never answered by a request sent before it.
 *
 * Keyed by the `fetch` the request went through: a request only answers
 * callers of the same transport. Each caller parses the shared payload itself,
 * so every caller still gets its own `PkgEntry[]`.
 */
const pendingPackageReads = new WeakMap<typeof fetch, Promise<unknown>>();
let packagesChangedObserved = false;

function dropPendingPackageRead(): void {
  pendingPackageReads.delete(globalThis.fetch);
}

function readPackagesPayload(): Promise<unknown> {
  // Registered on first use rather than at import, and so before the
  // switcher's own `objectui:packages-changed` listener (it calls this first,
  // then subscribes): the drop runs before the refetch that event triggers.
  if (!packagesChangedObserved && typeof window !== 'undefined') {
    packagesChangedObserved = true;
    window.addEventListener('objectui:packages-changed', dropPendingPackageRead);
  }
  const transport = globalThis.fetch;
  const pending = pendingPackageReads.get(transport);
  if (pending) return pending;
  const read = (async () => {
    const res = await fetch('/api/v1/packages', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(readEnvelopeFailureText(payload) ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<unknown>;
  })();
  pendingPackageReads.set(transport, read);
  const settle = () => {
    if (pendingPackageReads.get(transport) === read) pendingPackageReads.delete(transport);
  };
  read.then(settle, settle);
  return read;
}

/**
 * The duplicate operation's OWN result, which travels inside the dispatcher
 * envelope's `data` — not at the top level.
 *
 * `POST /packages/:id/duplicate` is served only by the runtime dispatcher, and
 * that door always wraps (`deps.success(result)` → `{ success: true, data }`).
 * So a top-level `success` read is reading the ENVELOPE, whose value is `true`
 * by construction on a 200. The operation's verdict is one level down, and it
 * is a real three-state: the server computes it as
 * `failed.length === 0 && copied.length > 0`, which leaves TWO reachable
 * outcomes that answer HTTP 200 with `data.success === false`:
 *
 *  1. PARTIAL — some items failed to copy. `failed[]` carries a per-item
 *     `error` string and is the ONLY place the reason is ever stated; a
 *     generic `HTTP nnn` here tells the author nothing.
 *  2. EMPTY — nothing was copied at all (e.g. a source package whose rows are
 *     outside this caller's scope). `failed[]` is empty in this arm — nothing
 *     is named as having failed — so the counts are the only signal.
 *
 * Those two are exhaustive for `success === false`: with no failures AND at
 * least one copy the server would have said `true`.
 */
interface DuplicateOutcome {
  success?: boolean;
  copiedCount?: number;
  failedCount?: number;
  failed?: Array<{ type?: string; name?: string; error?: string }>;
}

/** Per-item failures named in full before the message summarizes the rest. */
const DUPLICATE_FAILURE_DETAIL_LIMIT = 5;

/**
 * Turn a false operation verdict into something the Studio author can act on.
 * The counts say how far the copy got; `failed[].error` says why each item did
 * not make it. Both arms are reachable on a 200 — see {@link DuplicateOutcome}.
 */
function describeDuplicateFailure(outcome: DuplicateOutcome): string {
  const failed = Array.isArray(outcome.failed) ? outcome.failed : [];
  const failedCount = typeof outcome.failedCount === 'number' ? outcome.failedCount : failed.length;
  const copiedCount = typeof outcome.copiedCount === 'number' ? outcome.copiedCount : 0;
  if (failedCount > 0) {
    const shown = failed
      .slice(0, DUPLICATE_FAILURE_DETAIL_LIMIT)
      .map((f) => `${f.type || 'item'}/${f.name || '?'}: ${f.error || 'copy failed'}`);
    const rest = failed.length - shown.length;
    const detail = shown.length ? ` ${shown.join('; ')}${rest > 0 ? `; +${rest} more` : ''}` : '';
    return `Partial duplicate: ${copiedCount} item(s) copied, ${failedCount} failed.${detail}`;
  }
  return (
    'Nothing was copied: the duplicate is empty (0 items copied, 0 reported as failed). ' +
    "The source package may have no active items, or its rows may be outside this session's scope."
  );
}

/**
 * Duplicate a package into a NEW writable base (ADR-0070 D4 — the Airtable
 * "duplicate base" gesture; POST /packages/:id/duplicate). This is how a
 * read-only code package becomes a customizable starting point: objects are
 * re-namespaced and intra-package references rewritten server-side.
 *
 * Rejects on a transport/error-envelope failure AND on a false operation
 * verdict, which a 200 can carry. Unwrapping before reading that verdict is
 * the same order `revertCommit` uses for the sibling commit-revert route in
 * `preview/commitHistory.ts`.
 */
export async function duplicatePackage(sourceId: string, targetId: string, targetName?: string): Promise<void> {
  // objectui#11797 — a list read still pending when this write lands was asked
  // before it, so a read asked after it must not join that one. Dropped however
  // the write ends: a failed duplicate may still have copied part of a package.
  const res = await fetch(`/api/v1/packages/${encodeURIComponent(sourceId)}/duplicate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ targetPackageId: targetId, ...(targetName ? { targetName } : {}) }),
  }).finally(dropPendingPackageRead);
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    // The error envelope IS top-level (`{ success: false, error }`) — no `data`
    // to unwrap on this arm.
    //
    // Read by the SAME rule as `fetchPackages` above, and not by a second
    // hand-rolled ladder: this arm read `error.message` alone, so a
    // producer-marked `error.userMessage` — which the dispatcher door serving
    // this very route has emitted since objectstack `79c46da90` — had nowhere
    // to appear, and `error.code` was dropped too. One definition of the rule, in
    // {@link readEnvelopeFailureText}; leaving a copy of it a hundred lines
    // below the import is exactly the drift this extraction exists to stop.
    throw new Error(readEnvelopeFailureText(payload) ?? `HTTP ${res.status}`);
  }
  // Unwrap FIRST, then read the operation's flag. The `?? payload` arm mirrors
  // the commit-revert helper: it would classify a hypothetical bare (unwrapped)
  // answer instead of reading it as success. Against today's single wrapping
  // surface only the `data` arm is live.
  const inner = ((payload?.data as Record<string, unknown> | undefined) ?? payload ?? undefined) as
    | DuplicateOutcome
    | undefined;
  if (inner?.success === false) {
    throw new Error(describeDuplicateFailure(inner));
  }
}

/**
 * Is `v` a package id the INSTALLED `@objectstack/spec` accepts?
 *
 * The one id rule every package-id form in this app judges by: the *New
 * package* dialog, the Studio landing's *Duplicate* form and the package
 * sheet's *Duplicate* form (objectui#11792, objectui#11855). It is the
 * declaration the server refuses by: `POST /api/v1/packages` and
 * `POST /api/v1/packages/:id/duplicate` both parse the id with
 * `ManifestSchema.shape.id` before anything is written, answering 400
 * otherwise.
 *
 * Judged by the field schema, never by a grammar copied into this repo: the
 * hand-copied regex this replaces admitted underscores and refused a digit-led
 * first segment, so it disagreed with the server in both directions
 * (`com.acme.my_app` passed, `163.com.crm` did not). Reading the field schema
 * also survives the spec renaming or retiring whatever pattern constant backs
 * it.
 */
export function isSpecPackageId(v: string): boolean {
  return ManifestSchema.shape.id.safeParse(v).success;
}

/**
 * Object-namespace format (framework#2694 / `@objectstack/spec/kernel`): a
 * lowercase letter followed by 1–19 letters/digits/underscores (2–20 chars).
 * `deriveNamespaceFromPackageId` already sanitizes to this shape; the authoring
 * dialogs validate the user's edits against the same rule.
 */
export const NAMESPACE_RE = /^[a-z][a-z0-9_]{1,19}$/;

/**
 * Prefix an object name with the package namespace so it can't be authored
 * prefix-less (framework#2694 rejects those at publish with code
 * `NAMESPACE_PREFIX`). The compliance decision is the spec-owned rule
 * (`validateObjectNamespacePrefix`) — a `null` verdict means already-compliant
 * or exempt (e.g. `sys_*`), which we leave untouched (never double-prefix).
 * With no namespace we can't prefix, so the name passes through unchanged (the
 * server-side gate stays the backstop).
 */
export function prefixObjectName(rawName: string, namespace: string | null | undefined): string {
  if (!namespace) return rawName;
  return validateObjectNamespacePrefix(rawName, namespace) ? `${namespace}_${rawName}` : rawName;
}

/**
 * Normalize raw package-id keystrokes to the allowed alphabet, and SAY when
 * something was dropped — the wizard used to strip illegal characters
 * silently (`bad id!!` → `badid`), which reads as the input eating keys.
 * The `stripped` flag drives an inline notice. This is an input normalizer,
 * not the format authority: {@link isSpecPackageId} is. The alphabet keeps `_`
 * on purpose, although the spec admits none, so an underscore stays in the
 * field and the rule's hint, which names underscores, says why the id is
 * refused instead of the keystroke vanishing.
 */
export function sanitizePackageId(raw: string): { value: string; stripped: boolean } {
  const value = raw.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  // Lowercasing is benign normalization; only actually-dropped characters warrant the notice.
  return { value, stripped: value.length !== raw.length };
}
