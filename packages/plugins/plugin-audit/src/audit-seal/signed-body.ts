// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { AUDIT_SEAL_CANON_VERSION, canonicalDatetime, type SealedColumnSet } from './canonical.js';
import { canonicalJson, canonicalJsonBytes } from './jcs.js';

/**
 * ADR-0154 D4, D7, D8 — the signed bodies of a checkpoint and of an amendment,
 * built from a stored row and turned back into one.
 *
 * A signature covers the RFC 8785 form of the body ({@link signedBodyBytes}).
 * The body is rebuilt from the stored row through the same normalizer the
 * sealer used ({@link checkpointBodyFromRow}, {@link amendmentBodyFromRow}),
 * so a datetime a driver hands back as a `Date` or as SQL text, or a count it
 * hands back as a string, signs and verifies the same.
 *
 * ⛔ A body carries no value, no salt and no seed: commitments, roots,
 * digests and handle ids only (D2). That is what lets it leave the host.
 *
 * The stored row adds what is not signed: its `id`, its `signature`, and the
 * non-null `chain_key` the `(sealed_object, chain_key, sequence)` unique index
 * needs — NULL is distinct from NULL in a SQL unique index, so the deployment
 * chain's NULL `tenant_id` could not hold two sealers to one checkpoint per
 * sequence. The body keeps ADR-0154's `tenant_id`, NULL for the deployment
 * chain; `chain_key` is derived from it ({@link chainKeyOf}) and a verifier
 * checks the two agree.
 */

/** A malformed body or row, named with the field. */
export class SignedBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignedBodyError';
  }
}

/** Checkpoint kinds (D3): a window sealed on time, or rows that arrived after their window was sealed. */
export const AUDIT_CHECKPOINT_KINDS = ['window', 'late'] as const;
export type AuditCheckpointKind = (typeof AUDIT_CHECKPOINT_KINDS)[number];

/** Amendment kinds (D7, D8). */
export const AUDIT_AMENDMENT_KINDS = ['redaction', 'expiry'] as const;
export type AuditAmendmentKind = (typeof AUDIT_AMENDMENT_KINDS)[number];

/** The `chain_key` of the deployment chain (D5). */
export const DEPLOYMENT_CHAIN_KEY = 'deployment';

/** The non-null chain key a chain's rows are stored under: `org:<id>`, or `deployment` for NULL. */
export function chainKeyOf(tenantId: string | null): string {
  return tenantId === null ? DEPLOYMENT_CHAIN_KEY : `org:${tenantId}`;
}

/** What a checkpoint's signature covers (D4). */
export interface CheckpointSignedBody {
  readonly sealed_object: string;
  /** The chain's organization; `null` for the deployment chain (D5). */
  readonly tenant_id: string | null;
  readonly sequence: number;
  readonly kind: AuditCheckpointKind;
  readonly window_start: string;
  readonly window_end: string;
  /** The sealed-through watermark (D3). */
  readonly sealed_through: string;
  readonly leaf_count: number;
  readonly row_ids: readonly string[];
  /** The Merkle root, lowercase hex. */
  readonly root: string;
  /** SHA-256 of the chain's previous checkpoint's signed body; `null` for the first. */
  readonly previous_digest: string | null;
  readonly columns: SealedColumnSet;
  readonly canon_version: number;
  /** The `sys_secret` id of the sealed seed. */
  readonly seed_handle: string;
  /** The cluster lock's fencing token for the pass that wrote it, decimal. */
  readonly fencing_token: string;
  readonly sealed_at: string;
  readonly signing_key_id: string;
}

interface AmendmentCommon {
  readonly sealed_object: string;
  readonly tenant_id: string | null;
  readonly amended_at: string;
  readonly signing_key_id: string;
}

/** What a redaction amendment's signature covers (D7). */
export interface RedactionAmendmentBody extends AmendmentCommon {
  readonly kind: 'redaction';
  readonly checkpoint_id: string;
  readonly row_id: string;
  readonly column_name: string;
  readonly sealed_commitment: string;
  readonly rewritten_commitment: string;
  /** The migration that rewrote the value. */
  readonly rewritten_by: string;
}

/** What an expiry amendment's signature covers (D8). */
export interface ExpiryAmendmentBody extends AmendmentCommon {
  readonly kind: 'expiry';
  readonly first_sequence: number;
  readonly last_sequence: number;
  readonly covered_from: string;
  readonly covered_to: string;
  /** SHA-256 of the last removed checkpoint's signed body — what the first remaining one links to. */
  readonly last_removed_digest: string;
  /** The policy that expired the range, e.g. `archive.keep`. */
  readonly policy: string;
  /** Its value, under the signature, e.g. `7y` — what a verifier judges the expiry by. */
  readonly policy_value: string;
}

export type AmendmentSignedBody = RedactionAmendmentBody | ExpiryAmendmentBody;

// ── field readers ────────────────────────────────────────────────────────────

const HEX_DIGEST = /^[0-9a-f]{64}$/;

function text(row: Readonly<Record<string, unknown>>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '') throw new SignedBodyError(`${field}: a non-empty string is required`);
  return value;
}

function nullableText(row: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  return text(row, field);
}

function digest(row: Readonly<Record<string, unknown>>, field: string): string {
  const value = text(row, field);
  if (!HEX_DIGEST.test(value)) throw new SignedBodyError(`${field}: a lowercase hex SHA-256 digest is required`);
  return value;
}

function count(row: Readonly<Record<string, unknown>>, field: string): number {
  const raw = row[field];
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SignedBodyError(`${field}: a non-negative integer is required`);
  }
  return value;
}

function instant(row: Readonly<Record<string, unknown>>, field: string): string {
  try {
    return canonicalDatetime(row[field], field);
  } catch (err) {
    throw new SignedBodyError((err as Error).message);
  }
}

function oneOf<T extends string>(row: Readonly<Record<string, unknown>>, field: string, members: readonly T[]): T {
  const value = row[field];
  if (typeof value !== 'string' || !(members as readonly string[]).includes(value)) {
    throw new SignedBodyError(`${field}: one of ${members.join(', ')} is required`);
  }
  return value as T;
}

/** A lock's fencing token (a `bigint` on the lock handle) in its one spelling: decimal digits. */
function fencingToken(raw: unknown): string {
  const value = typeof raw === 'bigint' || typeof raw === 'number' ? String(raw) : raw;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new SignedBodyError('fencing_token: a non-negative integer in decimal is required');
  }
  return value;
}

/** A JSON column: stored as JCS text, or handed back already parsed by a driver with JSON columns. */
function json(row: Readonly<Record<string, unknown>>, field: string): unknown {
  const value = row[field];
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new SignedBodyError(`${field}: does not parse as JSON`);
  }
}

function sortedNames(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v === '')) {
    throw new SignedBodyError(`${field}: an array of names is required`);
  }
  const names = value as string[];
  for (let i = 1; i < names.length; i++) {
    if (!(names[i - 1] < names[i])) throw new SignedBodyError(`${field}: names must be sorted and unique`);
  }
  return [...names];
}

function columnSet(value: unknown): SealedColumnSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SignedBodyError('columns: { clear, committed } is required');
  const { clear, committed, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new SignedBodyError(`columns: unexpected member(s) ${Object.keys(rest).join(', ')}`);
  const set = { clear: sortedNames(clear, 'columns.clear'), committed: sortedNames(committed, 'columns.committed') };
  if (set.clear.some((name) => set.committed.includes(name))) throw new SignedBodyError('columns: a column is both clear and committed');
  return set;
}

// ── checkpoint ───────────────────────────────────────────────────────────────

/**
 * A checkpoint's signed body, validated and in canonical form. Accepts a body
 * or a stored row (whose JSON columns are text); anything outside the body —
 * `id`, `chain_key`, `signature` — is ignored here.
 */
export function checkpointBodyFromRow(row: Readonly<Record<string, unknown>>): CheckpointSignedBody {
  const rowIds = json(row, 'row_ids');
  if (!Array.isArray(rowIds) || rowIds.some((id) => typeof id !== 'string' || id === '')) {
    throw new SignedBodyError('row_ids: an array of row ids is required');
  }
  if (new Set(rowIds).size !== rowIds.length) throw new SignedBodyError('row_ids: a row is listed twice');
  const body: CheckpointSignedBody = {
    sealed_object: text(row, 'sealed_object'),
    tenant_id: nullableText(row, 'tenant_id'),
    sequence: count(row, 'sequence'),
    kind: oneOf(row, 'kind', AUDIT_CHECKPOINT_KINDS),
    window_start: instant(row, 'window_start'),
    window_end: instant(row, 'window_end'),
    sealed_through: instant(row, 'sealed_through'),
    leaf_count: count(row, 'leaf_count'),
    row_ids: [...(rowIds as string[])],
    root: digest(row, 'root'),
    previous_digest: row.previous_digest === null || row.previous_digest === undefined ? null : digest(row, 'previous_digest'),
    columns: columnSet(json(row, 'columns')),
    canon_version: count(row, 'canon_version'),
    seed_handle: text(row, 'seed_handle'),
    fencing_token: fencingToken(row.fencing_token),
    sealed_at: instant(row, 'sealed_at'),
    signing_key_id: text(row, 'signing_key_id'),
  };
  if (body.leaf_count !== body.row_ids.length) throw new SignedBodyError('leaf_count: does not equal the number of row_ids');
  if (body.leaf_count === 0) throw new SignedBodyError('leaf_count: an empty window writes no checkpoint');
  if (!(body.window_start < body.window_end)) throw new SignedBodyError('window_start: must precede window_end');
  if (body.canon_version !== AUDIT_SEAL_CANON_VERSION) throw new SignedBodyError(`canon_version: ${body.canon_version} is not a known canonical form`);
  if ((body.sequence === 0) !== (body.previous_digest === null)) {
    throw new SignedBodyError('previous_digest: null exactly for the first checkpoint of a chain (sequence 0)');
  }
  return body;
}

/** The stored row of a signed checkpoint. */
export function checkpointRow(
  body: CheckpointSignedBody,
  stored: { readonly id: string; readonly signature: string },
): Record<string, unknown> {
  const valid = checkpointBodyFromRow(body as unknown as Record<string, unknown>);
  return {
    ...valid,
    id: stored.id,
    chain_key: chainKeyOf(valid.tenant_id),
    row_ids: canonicalJson(valid.row_ids),
    columns: canonicalJson(valid.columns),
    signature: stored.signature,
  };
}

// ── amendment ────────────────────────────────────────────────────────────────

/** An amendment's signed body, validated and in canonical form, from a body or a stored row. */
export function amendmentBodyFromRow(row: Readonly<Record<string, unknown>>): AmendmentSignedBody {
  const common = {
    sealed_object: text(row, 'sealed_object'),
    tenant_id: nullableText(row, 'tenant_id'),
    amended_at: instant(row, 'amended_at'),
    signing_key_id: text(row, 'signing_key_id'),
  };
  const kind = oneOf(row, 'kind', AUDIT_AMENDMENT_KINDS);
  if (kind === 'redaction') {
    return {
      kind,
      ...common,
      checkpoint_id: text(row, 'checkpoint_id'),
      row_id: text(row, 'row_id'),
      column_name: text(row, 'column_name'),
      sealed_commitment: digest(row, 'sealed_commitment'),
      rewritten_commitment: digest(row, 'rewritten_commitment'),
      rewritten_by: text(row, 'rewritten_by'),
    };
  }
  const body: ExpiryAmendmentBody = {
    kind,
    ...common,
    first_sequence: count(row, 'first_sequence'),
    last_sequence: count(row, 'last_sequence'),
    covered_from: instant(row, 'covered_from'),
    covered_to: instant(row, 'covered_to'),
    last_removed_digest: digest(row, 'last_removed_digest'),
    policy: text(row, 'policy'),
    policy_value: text(row, 'policy_value'),
  };
  if (body.first_sequence > body.last_sequence) throw new SignedBodyError('first_sequence: must not follow last_sequence');
  if (!(body.covered_from < body.covered_to)) throw new SignedBodyError('covered_from: must precede covered_to');
  return body;
}

/** The stored row of a signed amendment. Columns of the other kind are stored NULL. */
export function amendmentRow(
  body: AmendmentSignedBody,
  stored: { readonly id: string; readonly signature: string },
): Record<string, unknown> {
  const valid = amendmentBodyFromRow(body as unknown as Record<string, unknown>);
  const empty = {
    checkpoint_id: null, row_id: null, column_name: null, sealed_commitment: null, rewritten_commitment: null, rewritten_by: null,
    first_sequence: null, last_sequence: null, covered_from: null, covered_to: null, last_removed_digest: null, policy: null, policy_value: null,
  };
  return { ...empty, ...valid, id: stored.id, chain_key: chainKeyOf(valid.tenant_id), signature: stored.signature };
}

// ── bytes and digests ────────────────────────────────────────────────────────

/** The bytes a signature covers: the body's RFC 8785 form, UTF-8. */
export function signedBodyBytes(body: CheckpointSignedBody | AmendmentSignedBody): Buffer {
  return canonicalJsonBytes(body);
}

/**
 * A checkpoint's digest — `SHA-256` of its signed body's bytes, lowercase hex.
 * The next checkpoint of the chain carries it as `previous_digest` (D4), and an
 * expiry carries the last removed one's as `last_removed_digest` (D8).
 */
export function checkpointDigest(body: CheckpointSignedBody): string {
  return createHash('sha256').update(signedBodyBytes(body)).digest('hex');
}
