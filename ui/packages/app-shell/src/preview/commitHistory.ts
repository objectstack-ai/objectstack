/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0067 — package-scoped commit history reads/writes for the timeline.
 *
 * Each AI build (and Studio batch) lands as one revertible COMMIT on top of
 * the metadata history. The history-not-confirm model: you don't approve each
 * publish — you review this timeline and revert if a change was wrong. These
 * helpers read the timeline (`GET /packages/:id/commits`) and revert one
 * commit (`POST /packages/:id/commits/:cid/revert`). Cookie-authenticated like
 * every console call; tolerant of the `{ data: ... }` / bare envelope shapes.
 *
 * ## Failures carry their KIND, not just a number (objectui#3529)
 *
 * Both calls used to flatten every non-OK response to `commits HTTP {status}` /
 * `HTTP {status}`. Correctness was never the gap — the throw is real, rendering
 * stops, and no fictional "no history" is ever shown, which is why
 * objectstack#5980 (ADR-0110 D3) needed no follow-up on this path. What was lost
 * is the MEANING the backend already sends, on the one screen where it matters
 * most: this is the ROLLBACK surface, read by an operator who is usually
 * mid-incident.
 *
 * A `503` is not a `404`. It says the commit store could not be reached, so the
 * call did not happen and the state is UNKNOWN — retry. A `404` says the store
 * answered, and the answer was "no". Those two get different dispositions from
 * an operator, so they get different presentations here.
 *
 * ### Which field actually carries the code
 *
 * The ADR-0112 envelope spells the semantic code at **`error.code`**:
 *
 * ```json
 * { "success": false,
 *   "error": { "code": "SERVICE_UNAVAILABLE", "message": "…", "httpStatus": 503 } }
 * ```
 *
 * objectui#3529's body points at `details.code`. Verified against the producer,
 * that is the SERVER-INTERNAL carrier only: `HttpDispatcher.errorFromThrown`
 * builds `details: { code: e.code }`, and `buildApiError`/`splitSemanticCode`
 * (objectstack `packages/runtime/src/error-envelope.ts`, objectstack-ai/objectstack#3842) then LIFT that
 * code into `error.code` and drop `details` entirely when it held nothing else.
 * So `details.code` never reaches the browser from this producer, and a consumer
 * reading it would be running a check that can only ever pass vacuously. We read
 * the declared field instead, and no alias chain beside it — a tolerant read of
 * a shape this endpoint does not send is exactly the consumer-side leniency
 * Prime Directive #12 removes.
 *
 * ### The envelope's `message` is NOT usable for this class
 *
 * The card also expects the 503's prose to say "unknown". It does not reach the
 * browser: `declaresServerFault` (objectstack `packages/types/src/error-leak.ts`,
 * objectstack-ai/objectstack#5811) is true for exactly this error — `status >= 500` WITH a string `code` —
 * so the dispatcher replaces the sentence with the generic
 * `INTERNAL_ERROR_MESSAGE` ("Internal server error") while `error.code` survives.
 * Rendering the envelope message here would therefore show an operator a generic
 * string and lose the status too. For the unreachable class the copy is authored
 * on THIS side; the envelope message is preferred only for the statuses where it
 * is not withheld (4xx), which is what keeps a 404 reading differently from a 500.
 *
 * ### Status decides first, on purpose
 *
 * Classification keys on `res.status` and treats the envelope code as a second
 * signal. A 503 does not always come from the application: a proxy or gateway
 * shedding load answers 503 with an HTML body and no envelope at all. The
 * operator's disposition must not depend on whether a body parsed, so status
 * alone is sufficient to produce the retryable reading.
 */

/**
 * A commit-store call that failed, carrying enough for a caller to tell the
 * dispositions apart without re-parsing anything.
 *
 * `retryable` is deliberately NOT "any 5xx". A `500` is the server saying it
 * broke while doing the work — whether the work happened is not something a
 * retry answers — and objectui#3529 names 404, 500 and 503 as three
 * presentations that must stay distinguishable. Only the unreachable class
 * (`503` / `SERVICE_UNAVAILABLE`) means "this did not happen".
 */
export class CommitStoreError extends Error {
  /** HTTP status of the failed response. */
  readonly status: number;
  /** ADR-0112 semantic code from `error.code`, or `null` when none arrived. */
  readonly code: string | null;
  /** True only for the unreachable class — see the class note. */
  readonly retryable: boolean;

  constructor(message: string, init: { status: number; code?: string | null; retryable: boolean }) {
    super(message);
    this.name = 'CommitStoreError';
    this.status = init.status;
    this.code = init.code ?? null;
    this.retryable = init.retryable;
  }
}

/**
 * Whether a caught value is the "commit store was unreachable" class.
 *
 * Duck-typed rather than `instanceof` so a value that crossed a bundle boundary
 * (two module instances of this file) still classifies. Anything else — a
 * `TypeError` from a rejected `fetch`, a 404, a 500 — is `false`, so the caller
 * falls through to its existing presentation instead of promising a retry it
 * cannot justify.
 */
export function isCommitStoreUnreachable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { retryable?: unknown }).retryable === true;
}

/** `code` / `message` out of an ADR-0112 error envelope, if there is one. */
function readErrorEnvelope(payload: unknown): { code: string | null; message: string | null } {
  const raw = (payload as { error?: unknown } | null | undefined)?.error;
  // `revertCommit`'s endpoint has always been able to answer `error: 'text'`;
  // keeping that is preserving existing behaviour, not adding a new alias.
  if (typeof raw === 'string') return { code: null, message: raw.trim() || null };
  if (!raw || typeof raw !== 'object') return { code: null, message: null };
  const e = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return { code: str(e.code), message: str(e.message) };
}

/**
 * Build the error for a non-OK commit-store response.
 *
 * `fallbackMessage` is the caller's pre-existing text, kept for the statuses
 * this change does not re-word: a 404 or 500 that arrives without an envelope
 * still reads exactly as it did before, which is what keeps those two
 * distinguishable from each other and from the retryable class.
 */
function commitStoreFailure(status: number, payload: unknown, fallbackMessage: string): CommitStoreError {
  const { code, message } = readErrorEnvelope(payload);
  const retryable = status === 503 || code === 'SERVICE_UNAVAILABLE';
  return new CommitStoreError(
    // The unreachable class is authored here — see the header: the producer
    // withholds its prose for exactly this class, so the envelope message is
    // `Internal server error` and would be strictly worse than a bare status.
    retryable
      ? `Commit store temporarily unreachable (HTTP ${status}) — the request did not reach it.`
      : message ?? fallbackMessage,
    { status, code, retryable },
  );
}

/** A touched item of a commit that names its bundle member (objectstack#23073). */
export interface CommitMemberItem {
  type: string;
  name: string;
  /**
   * `ListPackageCommitsResponseSchema` `commits[].items[].member`: present on
   * every item of a type whose identity is a pair (today only
   * `email_template`, `(name, locale)`), absent for a name-only type.
   */
  member: string;
}

export interface CommitEntry {
  id: string;
  operation: 'apply' | 'revert';
  message?: string;
  actor?: string;
  aiModel?: string;
  itemCount: number;
  createdAt?: string;
  /**
   * The commit's touched items that carry a `member`, in served order;
   * undefined when none does. Only these are kept: the timeline shows a member
   * where an item carries one and nothing extra for a name-only item, so two
   * languages of one template read as two items instead of one name twice.
   */
  memberItems?: CommitMemberItem[];
}

function memberItemsOf(raw: unknown): CommitMemberItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CommitMemberItem[] = [];
  for (const it of raw) {
    const i = it as Record<string, unknown> | null;
    if (
      i &&
      typeof i.type === 'string' &&
      typeof i.name === 'string' &&
      typeof i.member === 'string' &&
      i.member
    ) {
      out.push({ type: i.type, name: i.name, member: i.member });
    }
  }
  return out.length > 0 ? out : undefined;
}

export async function fetchCommits(packageId: string): Promise<CommitEntry[]> {
  const res = await fetch(`/api/v1/packages/${encodeURIComponent(packageId)}/commits`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    // Read the body defensively: a 503 shed by a proxy is HTML, and the
    // classification must survive that (it keys on the status first).
    const payload = await res.json().catch(() => null);
    throw commitStoreFailure(res.status, payload, `commits HTTP ${res.status}`);
  }
  const data = (await res.json()) as
    | unknown[]
    | { commits?: unknown[]; data?: { commits?: unknown[] } };
  const list = Array.isArray(data)
    ? data
    : (data as { commits?: unknown[] })?.commits ??
      (data as { data?: { commits?: unknown[] } })?.data?.commits ??
      [];
  return (Array.isArray(list) ? list : []).map((raw) => {
    const c = raw as Record<string, unknown>;
    return {
      id: String(c.id),
      operation: c.operation === 'revert' ? 'revert' : 'apply',
      message: typeof c.message === 'string' ? c.message : undefined,
      actor: typeof c.actor === 'string' ? c.actor : undefined,
      aiModel: typeof c.aiModel === 'string' ? c.aiModel : undefined,
      itemCount: typeof c.itemCount === 'number' ? c.itemCount : 0,
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : undefined,
      memberItems: memberItemsOf(c.items),
    } satisfies CommitEntry;
  });
}

export async function revertCommit(packageId: string, commitId: string): Promise<void> {
  const res = await fetch(
    `/api/v1/packages/${encodeURIComponent(packageId)}/commits/${encodeURIComponent(commitId)}/revert`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    },
  );
  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const inner = (payload?.data as Record<string, unknown> | undefined) ?? payload ?? undefined;
  if (!res.ok || (inner as { success?: boolean })?.success === false) {
    throw commitStoreFailure(res.status, payload, `HTTP ${res.status}`);
  }
}
