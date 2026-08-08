// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stored ENVELOPE / authored BODY split (#5309).
 *
 * ## The defect this exists to remove
 *
 * A metadata *type name* is worn by two different documents in this codebase:
 *
 *  - the **authored declaration** — exactly the vocabulary its spec schema
 *    declares, written by a human or (ADR-0033) an AI author;
 *  - the **stored row** — that declaration plus the metadata layer's own
 *    bookkeeping: `packageId`, `state`, `version`, `publishedDefinition`,
 *    `publishedAt`, `publishedBy`, written by {@link
 *    import('./metadata-manager.js').MetadataManager.register} and
 *    `publishPackage`, and read back by `publishPackage`'s own package filter.
 *
 * Those bookkeeping keys are NOT vocabulary. As long as a spec schema strips
 * unknown keys the difference is invisible — and that is precisely the problem:
 * the same permissiveness that lets `packageId` through also lets a `cacheTTL`
 * / `outputMappings` typo through, so an author's policy or projection silently
 * does not ship (ADR-0078). `api` sits on the #4001 campaign's `STILL_STRIP`
 * list for exactly this reason, measured in #5271: closing `ApiEndpointSchema`
 * made every stored row fail with `unrecognized_keys: ['packageId', 'state']`,
 * so the load-time backstop excluded the endpoint (its route answered 404) and
 * the publish gate reported a schema error instead of its ADR-0121 D6 verdict.
 *
 * The fix is NOT to teach a vocabulary two storage keys — that would make the
 * author-facing contract describe the storage layer, the trade Prime Directive
 * #12 refuses. It is to peel the envelope off **before** the body is handed to
 * its schema, which is what this module does.
 *
 * ## The rule, in one sentence
 *
 * A stored row is an envelope around a body: when the row carries a
 * {@link STORED_BODY_KEY} value the body is that value and everything beside
 * it is envelope; otherwise the body is the row minus the declared
 * {@link STORED_ENVELOPE_KEYS}.
 *
 * Neither half is invented here. `metadata ?? row` is already the metadata
 * layer's body-selection rule in three places — `publishPackage`'s
 * `publishedDefinition` snapshot, `getPublished`'s fallback, and
 * `gateApiItemsForPublish` — and {@link STORED_ENVELOPE_KEYS} is the list of
 * keys `MetadataManager` itself writes onto, or filters rows by. This module
 * gives that rule ONE spelling so the two `ApiEndpointSchema` parse sites
 * (`buildEndpointIndex`, `gateApiItemsForPublish`) can never disagree about
 * what the document is.
 *
 * ## What it deliberately does NOT do
 *
 *  - **It never mutates the row.** It returns views, so every existing reader
 *    of the envelope (`publishPackage`'s `meta?.packageId === packageId`
 *    filter, `query`'s `state` / `packageId` filters, `revertPackage`) keeps
 *    reading exactly the object it read before.
 *  - **It does not re-shape what publish snapshots.** `publishedDefinition`
 *    keeps its current bytes (`structuredClone(data.metadata ?? data)`),
 *    envelope keys included, because `revertPackage` restores from it. Peeling
 *    the snapshot is a stored-format change; this module is the parse
 *    boundary only.
 *  - **It is not a schema.** It removes keys the storage layer put there; it
 *    makes no judgement about the body, which is the schema's job and stays
 *    the schema's job.
 *
 * @see packages/spec/src/api/endpoint.zod.ts — the `STILL_STRIP` note this
 *   split is the prerequisite for closing (#5384 owns the closing itself).
 */

/**
 * The metadata layer's bookkeeping keys on a stored row.
 *
 * Every entry is written by `MetadataManager` or read by it as row identity —
 * none of them is authorable vocabulary for any metadata type:
 *
 * | key | written by | read by |
 * |---|---|---|
 * | `packageId` | callers / publish envelope | `publishPackage`, `unregisterPackage`, `revertPackage`, `query`, realtime event |
 * | `package` | legacy package stamp | the same three package filters |
 * | `state` | `publishPackage`, `revertPackage` | `query`, the dependency-published check |
 * | `version` | `publishPackage` | `publishPackage` (next version) |
 * | `publishedDefinition` | `publishPackage` | `revertPackage`, `getPublished`, the dependency-published check |
 * | `publishedAt` / `publishedBy` | `publishPackage` | publish bookkeeping |
 *
 * Adding a key here is a real decision: it removes that key from every body a
 * peeled parse sees. Add one only when `MetadataManager` itself writes or
 * filters on it.
 */
export const STORED_ENVELOPE_KEYS = Object.freeze([
  'package',
  'packageId',
  'publishedAt',
  'publishedBy',
  'publishedDefinition',
  'state',
  'version',
] as const);

/**
 * The key a stored row uses to carry its authored body — the publish envelope
 * shape `{ name, packageId, state, metadata: {…authored} }`.
 */
export const STORED_BODY_KEY = 'metadata';

const ENVELOPE_KEYS = new Set<string>([...STORED_ENVELOPE_KEYS, STORED_BODY_KEY]);

const EMPTY_ENVELOPE: Readonly<Record<string, unknown>> = Object.freeze({});

/** A stored row split into the layer's bookkeeping and the authored document. */
export interface PeeledStoredItem {
  /**
   * The bookkeeping the metadata layer wrote around the body. Frozen, and a
   * VIEW — the stored row itself is untouched.
   */
  readonly envelope: Readonly<Record<string, unknown>>;
  /**
   * The authored document, ready for its spec schema. `unknown` on purpose:
   * peeling an envelope says nothing about whether the body is valid.
   */
  readonly body: unknown;
  /** `true` when the row carried its body under {@link STORED_BODY_KEY}. */
  readonly wrapped: boolean;
}

/**
 * Split a stored metadata row into its envelope and its authored body.
 *
 * Total by construction — a non-object row (or `undefined`) is handed back as
 * the body with an empty envelope, so the caller's schema reports the real
 * problem instead of this function inventing one.
 *
 * @param item a value read out of the registry or a loader.
 */
export function peelStoredEnvelope(item: unknown): PeeledStoredItem {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return { envelope: EMPTY_ENVELOPE, body: item, wrapped: false };
  }

  const row = item as Record<string, unknown>;
  const wrappedBody = row[STORED_BODY_KEY];

  // The publish-envelope shape. Everything beside the body IS envelope by
  // construction, so no key list is consulted — the row said so itself.
  // `!= null` (not `in`) mirrors the `data.metadata ?? data` rule this
  // replaces, so a row with `metadata: null` keeps falling through to the flat
  // branch exactly as it does today.
  if (wrappedBody !== undefined && wrappedBody !== null) {
    const envelope: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if (key === STORED_BODY_KEY) continue;
      envelope[key] = row[key];
    }
    return { envelope: Object.freeze(envelope), body: wrappedBody, wrapped: true };
  }

  // The flat shape: body and bookkeeping share one level, so the declared key
  // list is the only thing that can tell them apart.
  let envelope: Record<string, unknown> | undefined;
  for (const key of Object.keys(row)) {
    if (!ENVELOPE_KEYS.has(key)) continue;
    envelope ??= {};
    envelope[key] = row[key];
  }

  // An authored declaration carries no bookkeeping at all — hand back the very
  // object that came in, so nothing about an authored parse changes, not even
  // object identity.
  if (!envelope) return { envelope: EMPTY_ENVELOPE, body: row, wrapped: false };

  const body: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    body[key] = row[key];
  }
  return { envelope: Object.freeze(envelope), body, wrapped: false };
}

/**
 * The `name` a stored row is known by, for a diagnostic that must name the
 * offending row even when its body failed to parse.
 *
 * Reads the envelope first and the body second, which is the SAME answer
 * `item.name` gave before the split: on the flat shape `name` lives in the
 * body, on the publish envelope it lives outside `metadata`.
 */
export function storedItemName(peeled: PeeledStoredItem): string | undefined {
  const fromEnvelope = peeled.envelope.name;
  if (typeof fromEnvelope === 'string') return fromEnvelope;
  const body = peeled.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const fromBody = (body as { name?: unknown }).name;
    if (typeof fromBody === 'string') return fromBody;
  }
  return undefined;
}
