// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { IAuditCheckpointSigner, IAuditCheckpointSink } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import { canonicalDatetime } from './canonical.js';
import { AUDIT_AMENDMENT_OBJECT, AUDIT_CHECKPOINT_OBJECT } from './seed.js';
import {
  amendmentBodyFromRow,
  amendmentRow,
  chainKeyOf,
  checkpointBodyFromRow,
  checkpointDigest,
  signedBodyBytes,
  type CheckpointSignedBody,
  type ExpiryAmendmentBody,
} from './signed-body.js';
import { dropAuditSealSecret, type SealStorageDriver, type SealStorageEngine } from './signer.js';
import type { SigningKeyTrust } from './verifier.js';

/**
 * ADR-0154 D8 — expiry removes a sealed prefix of each chain and writes a
 * signed amendment. This is the audit plugin's half of the seam the
 * LifecycleService calls (`LifecycleExpiryPrefix` in `@objectstack/objectql`):
 * it answers, per chain, the run of whole checkpoints that expired and the
 * rows they list, having signed and stored the chain's `expiry` amendment
 * first. The sweep then deletes exactly those rows, and only after them
 * {@link AuditExpiryRun.complete} removes the run's checkpoints and seeds.
 *
 * Per chain, the run starts at the chain's first remaining sequence, which
 * must be the sequence right after the chain's last admitted expiry (or 0):
 * the verifier honours an expiry only there. It takes consecutive checkpoints
 * while each covers a window that ended at or before the cutoff, each is
 * admitted under the trust rule of D6 (its signature verifies under a trusted
 * key), and the rows of one sweep stay within {@link AUDIT_EXPIRY_MAX_ROWS_PER_SWEEP}.
 * A chain whose first remaining sequence is not that one — a checkpoint
 * deleted outside the platform — is not expired, and is said once: an expiry
 * there would never be honoured, and `os audit verify` reports the gap.
 *
 * A sweep interrupted after the amendment was stored resumes it: when the
 * chain's last admitted expiry still covers its first remaining checkpoint,
 * that range's remaining rows and checkpoints are answered again, and no new
 * amendment is written before it is done. A stored amendment that is not
 * admitted is never acted on: it deletes nothing.
 *
 * Two bounds, both of this file's own:
 *  - **The cutoff is aligned down to a UTC day.** A chain then gains at most
 *    one expiry amendment a day in step with the clock, where an hourly sweep
 *    would sign one an hour, forever: amendments are never removed. It keeps
 *    a row up to one day past its policy, on top of D8's own bound.
 *  - **At most {@link AUDIT_EXPIRY_MAX_ROWS_PER_SWEEP} rows a sweep**, the
 *    Archiver's own bound (500 rows × 20 batches), across all of the object's
 *    chains: the backlog drains across sweeps, so a backlog keeps rows longer
 *    than the day above, and a run cut there continues in the next amendment,
 *    which starts at the sequence directly after it.
 */

type Row = Record<string, unknown>;

/** Rows one sweep expires per sealed object at most — the Archiver's bound per sweep. */
export const AUDIT_EXPIRY_MAX_ROWS_PER_SWEEP = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Checkpoints read per page of one chain's run. A checkpoint lists up to 10,000 row ids, so pages stay small. */
const PAGE_SIZE = 20;
/** Stored expiry amendments read per page while looking for a chain's newest admitted one. */
const AMENDMENT_PAGE_SIZE = 50;
/** Row ids per read of their owners (S4). */
const OWNER_READ_BATCH = 500;
const MAX_SIGN_ATTEMPTS = 3;
const NO_KEY_YET = 'unknown';

const iso = (ms: number): string => new Date(ms).toISOString();

/** The cutoff an expiry judges windows by: the policy's, aligned down to a UTC day (see the module header). */
export function auditExpiryCutoff(cutoffMs: number): number {
  return Math.floor(cutoffMs / DAY_MS) * DAY_MS;
}

/** What the sweep asks (`LifecycleExpiryPrefixRequest`, `@objectstack/objectql`). */
export interface AuditExpiryRequest {
  readonly object: string;
  readonly policy: string;
  readonly policyValue: string;
  readonly cutoff: string;
  /** Tenant-scoped windows, each for the rows its organization owns by {@link tenantColumn} (see {@link windowOf}). */
  readonly tenants?: ReadonlyArray<{ readonly tenantId: string; readonly policyValue: string; readonly cutoff: string }>;
  /** The column {@link tenants} are configured on, which need not be the chain column. */
  readonly tenantColumn?: string;
}

/** The window one chain expires under: its day-aligned cutoff and the policy value its amendment signs. */
interface ChainWindow {
  readonly cutoffMs: number;
  readonly policyValue: string;
}

const cutoffOf = (cutoff: string): number => {
  const ms = auditExpiryCutoff(Date.parse(cutoff));
  if (!Number.isFinite(ms)) throw new Error(`the expiry cutoff '${cutoff}' is not an instant`);
  return ms;
};

/**
 * The window chain `key` expires under, for an object chained on `chainField`,
 * never shorter than the window configured for any row it holds (seat ruling
 * on review 7202871622 S4).
 *
 * - No tenant window: the global one.
 * - Not an organization's chain (the deployment chain): the longest of the
 *   global window and every tenant window.
 * - The tenant windows are configured on the chain column itself: the chain
 *   holds its organization's rows alone, so it takes that organization's
 *   window, else the global one.
 * - Otherwise a chain may hold rows several organizations own, by the column
 *   the windows are configured on. `owners` are those owners, one per row
 *   (`null` for a row about no organization, `undefined` for a row that could
 *   not be read): the chain takes the longest window among them, an owner
 *   with no window of its own taking the global one and an unread row the
 *   longest of all. Without `owners`, the longest of all.
 */
export function windowOf(
  request: AuditExpiryRequest,
  key: string,
  chainField: string,
  owners?: ReadonlyArray<string | null | undefined>,
): ChainWindow {
  const global: ChainWindow = { cutoffMs: cutoffOf(request.cutoff), policyValue: request.policyValue };
  const tenants = request.tenants ?? [];
  if (tenants.length === 0) return global;
  const windowOfTenant = (t: (typeof tenants)[number]): ChainWindow => ({ cutoffMs: cutoffOf(t.cutoff), policyValue: t.policyValue });
  // The longest window is the earliest cutoff.
  const longest = (windows: readonly ChainWindow[]): ChainWindow =>
    windows.length === 0 ? global : windows.reduce((a, b) => (b.cutoffMs < a.cutoffMs ? b : a));
  const longestOfAll = longest([global, ...tenants.map(windowOfTenant)]);
  if (!key.startsWith('org:')) return longestOfAll;
  const ownerWindow = (owner: string | null): ChainWindow => {
    const own = owner === null ? undefined : tenants.find((t) => t.tenantId === owner);
    return own ? windowOfTenant(own) : global;
  };
  if (request.tenantColumn === chainField) return ownerWindow(key.slice('org:'.length));
  if (!owners) return longestOfAll;
  if (owners.some((o) => o === undefined)) return longestOfAll;
  return longest([...new Set(owners as ReadonlyArray<string | null>)].map(ownerWindow));
}

/** One chain's planned expiry (`LifecycleExpiryPrefixRun`, `@objectstack/objectql`). */
export interface AuditExpiryRun {
  readonly chain: string;
  readonly rowIds: readonly string[];
  complete(): Promise<void>;
}

/** What one object's expiry needs, resolved by the sealer for one call. */
export interface ObjectExpiryOptions {
  readonly engine: SealStorageEngine;
  readonly object: string;
  /** The object's chain column (`lifecycle.seal.chainField`, default `tenant_id`). */
  readonly chainField: string;
  /** The object's `archive.to` datasource, if it has one: owners of archived rows are read there (S4). */
  readonly archive?: SealStorageDriver;
  readonly signer: IAuditCheckpointSigner & { activeKeyId?(): Promise<string | null> };
  readonly sink?: IAuditCheckpointSink;
  readonly trust: SigningKeyTrust;
  /** Said once per cause by the sealer: a chain that cannot be expired, and why. */
  readonly say: (cause: string, message: string) => void;
  readonly warn: (message: string) => void;
  readonly now: () => number;
}

interface Taken {
  readonly stored: Row;
  readonly body: CheckpointSignedBody;
}

const messageOf = (err: unknown): string => String((err as Error)?.message ?? err);

/** One sealed object's expiry for one sweep. */
export class ObjectExpiry {
  private readonly checkpoints: SealStorageDriver;
  private readonly amendments: SealStorageDriver | undefined;
  private keyId: string | null = null;
  /** Whether the plan reached every chain that has an expired window, or stopped on its row bound. */
  drained = true;

  constructor(private readonly options: ObjectExpiryOptions) {
    const checkpoints = options.engine.getDriverForObject(AUDIT_CHECKPOINT_OBJECT);
    if (!checkpoints) throw new Error(`no driver resolves for '${AUDIT_CHECKPOINT_OBJECT}'`);
    if (typeof checkpoints.delete !== 'function') {
      throw new Error(`the driver of '${AUDIT_CHECKPOINT_OBJECT}' cannot delete a row, so no checkpoint can be expired`);
    }
    this.checkpoints = checkpoints;
    this.amendments = options.engine.getDriverForObject(AUDIT_AMENDMENT_OBJECT);
  }

  private get object(): string {
    return this.options.object;
  }

  /** The runs of this sweep, each chain's amendment stored before it is answered. */
  async plan(request: AuditExpiryRequest): Promise<AuditExpiryRun[]> {
    // A chain is found by a checkpoint that ended by the LATEST cutoff any chain may use; its own window decides.
    let cutoffMs = cutoffOf(request.cutoff);
    for (const t of request.tenants ?? []) cutoffMs = Math.max(cutoffMs, cutoffOf(t.cutoff));
    const runs: AuditExpiryRun[] = [];
    let budget = AUDIT_EXPIRY_MAX_ROWS_PER_SWEEP;
    // Chains in `chain_key` order, each found by one checkpoint of an expired window: a keyset walk, one row a step.
    for (let after: string | undefined; ;) {
      if (budget <= 0) {
        this.drained = false;
        break;
      }
      const where: Row = { sealed_object: this.object, window_end: { $lte: iso(cutoffMs) } };
      if (after !== undefined) where.chain_key = { $gt: after };
      const [candidate] = await this.find(this.checkpoints, AUDIT_CHECKPOINT_OBJECT, {
        where,
        orderBy: [{ field: 'chain_key', order: 'asc' }],
        limit: 1,
      });
      if (!candidate) break;
      const key = String(candidate.chain_key);
      after = key;
      const run = await this.chainRun(key, budget, request);
      if (!run) continue;
      runs.push(run.run);
      budget -= run.run.rowIds.length;
      if (run.cut) this.drained = false;
    }
    return runs;
  }

  private async find(driver: SealStorageDriver, object: string, query: Row): Promise<Row[]> {
    try {
      return await driver.find(object, query);
    } catch (err) {
      if (isMissingTableError(err, object)) return [];
      throw err;
    }
  }

  private parse(key: string, stored: Row): CheckpointSignedBody | null {
    try {
      return checkpointBodyFromRow(stored);
    } catch (err) {
      this.options.say(
        `expiry:malformed:${this.object}:${key}`,
        `AuditSealer: '${this.object}' chain '${key}' is NOT expired: its checkpoint ${String(stored.sequence)} is ` +
          `malformed (${messageOf(err)}), so its rows past the policy are kept. os audit verify reports it.`,
      );
      return null;
    }
  }

  /**
   * Whether a stored body belongs where it is stored: its signed object is this
   * one and its signed organization is chain `key`. The row's `sealed_object`
   * and `chain_key` columns are not signed; the body is.
   */
  private bound(key: string, body: { readonly sealed_object: string; readonly tenant_id: string | null }): boolean {
    return body.sealed_object === this.object && chainKeyOf(body.tenant_id) === key;
  }

  /** A chain holding a row that is not bound to it is not expired at all, and that is said once. */
  private refuseUnbound(key: string, what: string): null {
    this.options.say(
      `expiry:unbound:${this.object}:${key}`,
      `AuditSealer: '${this.object}' chain '${key}' is NOT expired: ${what} stored under it is signed for another ` +
        'object or organization. Nothing in the chain is deleted; os audit verify reports it.',
    );
    return null;
  }

  /** A chain whose checkpoints do not link one to the next is not expired at all, and that is said once. */
  private refuseUnlinked(key: string, sequence: number): null {
    this.options.say(
      `expiry:link:${this.object}:${key}`,
      `AuditSealer: '${this.object}' chain '${key}' is NOT expired: its checkpoint ${sequence} does not link to the ` +
        'one before it (or to the last expiry). Nothing in the chain is deleted; os audit verify reports the link.',
    );
    return null;
  }

  /**
   * The chain's last expiry that is admitted — bound to the chain and signed
   * under a trusted key — if any, walking every stored one newest first. A
   * stored expiry under the chain that is bound elsewhere answers `null`: the
   * chain is not expired at all.
   */
  private async latestExpiry(key: string): Promise<ExpiryAmendmentBody | undefined | null> {
    if (!this.amendments) return undefined;
    for (let offset = 0; ; offset += AMENDMENT_PAGE_SIZE) {
      const rows = await this.find(this.amendments, AUDIT_AMENDMENT_OBJECT, {
        where: { sealed_object: this.object, chain_key: key, kind: 'expiry' },
        orderBy: [{ field: 'last_sequence', order: 'desc' }, { field: 'id', order: 'asc' }],
        limit: AMENDMENT_PAGE_SIZE,
        offset,
      });
      for (const stored of rows) {
        let body;
        try {
          body = amendmentBodyFromRow(stored);
        } catch {
          continue;
        }
        if (body.kind !== 'expiry') continue;
        if (!this.bound(key, body)) return this.refuseUnbound(key, `the expiry amendment ${String(stored.id)}`);
        if ((await this.options.trust.signature(body.signing_key_id, signedBodyBytes(body), stored.signature)) === 'ok') return body;
      }
      if (rows.length < AMENDMENT_PAGE_SIZE) return undefined;
    }
  }

  /**
   * The owners of `ids` by `column`, one per id, read from the object's hot
   * store and then its archive for the ids the hot store does not hold
   * (`undefined` for a row neither holds).
   */
  private async ownersOf(ids: readonly string[], column: string): Promise<Array<string | null | undefined>> {
    const byId = new Map<string, string | null>();
    const hot = this.options.engine.getDriverForObject(this.object);
    for (const store of [hot, this.options.archive]) {
      if (!store) continue;
      const unread = ids.filter((id) => !byId.has(id));
      for (let at = 0; at < unread.length; at += OWNER_READ_BATCH) {
        const batch = unread.slice(at, at + OWNER_READ_BATCH);
        for (const row of await this.find(store, this.object, { where: { id: { $in: batch } }, limit: batch.length })) {
          const owner = row[column];
          byId.set(String(row.id), owner === null || owner === undefined || owner === '' ? null : String(owner));
        }
      }
    }
    return ids.map((id) => (byId.has(id) ? byId.get(id)! : undefined));
  }

  private async chainRun(
    key: string,
    budget: number,
    request: AuditExpiryRequest,
  ): Promise<{ run: AuditExpiryRun; cut: boolean } | null> {
    const [firstRow] = await this.find(this.checkpoints, AUDIT_CHECKPOINT_OBJECT, {
      where: { sealed_object: this.object, chain_key: key },
      orderBy: [{ field: 'sequence', order: 'asc' }],
      limit: 1,
    });
    if (!firstRow) return null;
    const first = this.parse(key, firstRow);
    if (!first) return null;
    // Each checkpoint either branch takes, this first one included, is bound to the chain before it is taken.
    const latest = await this.latestExpiry(key);
    if (latest === null) return null;

    // A sweep that stopped after the amendment was stored: its range is finished first. Each checkpoint left in
    // it is admitted as in a fresh run — bound to the chain, signed under a trusted key — and they must run
    // consecutively, each linked to the one before, to the amendment's last sequence, whose digest it carries:
    // a row that is not the platform's own deletes nothing, and neither does its range.
    if (latest && latest.last_sequence >= first.sequence) {
      if (first.sequence < latest.first_sequence) return this.refuseResume(key, latest, first.sequence);
      const taken: Taken[] = [];
      let next = first.sequence;
      for (const stored of await this.find(this.checkpoints, AUDIT_CHECKPOINT_OBJECT, {
        where: { sealed_object: this.object, chain_key: key, sequence: { $lte: latest.last_sequence } },
        // Ascending, so complete() removes the newest checkpoint last (see runOf).
        orderBy: [{ field: 'sequence', order: 'asc' }],
      })) {
        const body = this.parse(key, stored);
        if (!body) return null;
        if (!this.bound(key, body)) return this.refuseUnbound(key, `the checkpoint ${body.sequence}`);
        if (body.sequence !== next) return this.refuseResume(key, latest, body.sequence);
        const previous = taken[taken.length - 1];
        if (previous && body.previous_digest !== checkpointDigest(previous.body)) return this.refuseResume(key, latest, body.sequence);
        if ((await this.options.trust.signature(body.signing_key_id, signedBodyBytes(body), stored.signature)) !== 'ok') {
          return this.refuseResume(key, latest, body.sequence);
        }
        taken.push({ stored, body });
        next += 1;
      }
      if (taken.length === 0) return null;
      const last = taken[taken.length - 1].body;
      if (last.sequence !== latest.last_sequence || checkpointDigest(last) !== latest.last_removed_digest) {
        return this.refuseResume(key, latest, last.sequence);
      }
      return { run: this.runOf(key, taken), cut: false };
    }

    const expected = latest ? latest.last_sequence + 1 : 0;
    if (first.sequence !== expected) {
      this.options.say(
        `expiry:gap:${this.object}:${key}`,
        `AuditSealer: '${this.object}' chain '${key}' is NOT expired: its first remaining checkpoint is sequence ` +
          `${first.sequence}, where its expiries end before ${expected} — checkpoints were removed outside the ` +
          'platform, and an expiry here would not be honoured. Its rows past the policy are kept; os audit verify ' +
          'reports the gap.',
      );
      return null;
    }
    // The first links to the last expiry's last removed checkpoint (sequence 0 links to nothing: `parse` holds it).
    if (latest && first.previous_digest !== latest.last_removed_digest) return this.refuseUnlinked(key, first.sequence);

    // Where a chain may hold rows several organizations own, each checkpoint's owners decide its window (S4).
    const byOwners =
      key.startsWith('org:') && (request.tenants?.length ?? 0) > 0 && request.tenantColumn !== undefined &&
      request.tenantColumn !== this.options.chainField;
    const owners: Array<string | null | undefined> = [];
    let window = windowOf(request, key, this.options.chainField, byOwners ? [] : undefined);

    const taken: Taken[] = [];
    let rows = 0;
    let cut = false;
    let next = first.sequence;
    walk: for (;;) {
      const page = await this.find(this.checkpoints, AUDIT_CHECKPOINT_OBJECT, {
        where: { sealed_object: this.object, chain_key: key, sequence: { $gte: next } },
        orderBy: [{ field: 'sequence', order: 'asc' }],
        limit: PAGE_SIZE,
      });
      for (const stored of page) {
        const body = this.parse(key, stored);
        if (!body || body.sequence !== next) break walk; // a malformed checkpoint or a gap ends the run
        if (!this.bound(key, body)) return this.refuseUnbound(key, `the checkpoint ${body.sequence}`);
        const previous = taken[taken.length - 1];
        if (previous && body.previous_digest !== checkpointDigest(previous.body)) return this.refuseUnlinked(key, body.sequence);
        let candidate = window;
        if (byOwners) {
          owners.push(...(await this.ownersOf(body.row_ids, request.tenantColumn!)));
          candidate = windowOf(request, key, this.options.chainField, owners);
        }
        if (Date.parse(canonicalDatetime(body.window_end, 'window_end')) > candidate.cutoffMs) break walk;
        if (taken.length > 0 && rows + body.row_ids.length > budget) {
          cut = true;
          break walk;
        }
        if ((await this.options.trust.signature(body.signing_key_id, signedBodyBytes(body), stored.signature)) !== 'ok') {
          this.options.say(
            `expiry:untrusted:${this.object}:${key}:${body.sequence}`,
            `AuditSealer: '${this.object}' chain '${key}' is expired only up to its checkpoint ${body.sequence}, ` +
              'whose signature does not verify under a trusted signing key: an expiry signs only what it can show ' +
              'the platform sealed. Its rows past the policy are kept; os audit verify reports the checkpoint.',
          );
          break walk;
        }
        // The window only lengthens as owners join, and windows end in order: every checkpoint taken ended by it.
        window = candidate;
        taken.push({ stored, body });
        rows += body.row_ids.length;
        next += 1;
      }
      if (page.length < PAGE_SIZE) break;
    }
    if (taken.length === 0) return null;
    await this.writeExpiry(taken, request.policy, window.policyValue);
    return { run: this.runOf(key, taken), cut };
  }

  /** A stored expiry's unfinished range holds a checkpoint that is not admitted: it is not resumed, and that is said once. */
  private refuseResume(key: string, latest: ExpiryAmendmentBody, sequence: number): null {
    this.options.say(
      `expiry:resume:${this.object}:${key}`,
      `AuditSealer: '${this.object}' chain '${key}' is NOT expired further: the range its expiry ` +
        `${latest.first_sequence}–${latest.last_sequence} still holds, at checkpoint ${sequence}, one that does not ` +
        'verify under a trusted signing key or does not follow the one before it. Nothing in that range is deleted; ' +
        'os audit verify reports the checkpoint.',
    );
    return null;
  }

  /** Sign and store the chain's `expiry` amendment over `taken` (D8), then hand it to the sink. */
  private async writeExpiry(taken: readonly Taken[], policy: string, policyValue: string): Promise<void> {
    const first = taken[0].body;
    const last = taken[taken.length - 1].body;
    let from = first.window_start;
    let to = first.window_end;
    for (const { body } of taken) {
      if (body.window_start < from) from = body.window_start;
      if (body.window_end > to) to = body.window_end;
    }
    const amendedAt = iso(this.options.now());
    const build = (signingKeyId: string): ExpiryAmendmentBody => ({
      kind: 'expiry',
      sealed_object: this.object,
      tenant_id: first.tenant_id,
      amended_at: amendedAt,
      signing_key_id: signingKeyId,
      first_sequence: first.sequence,
      last_sequence: last.sequence,
      covered_from: from,
      covered_to: to,
      last_removed_digest: checkpointDigest(last),
      policy,
      policy_value: policyValue,
    });
    const { signer } = this.options;
    // The S1 loop: a signature whose key id differs from the one its bytes name is never stored.
    let expected = this.keyId ?? (await signer.activeKeyId?.()) ?? NO_KEY_YET;
    let signed: { body: ExpiryAmendmentBody; signature: string } | undefined;
    for (let attempt = 0; attempt < MAX_SIGN_ATTEMPTS && !signed; attempt++) {
      const body = build(expected);
      const { keyId, signature } = await signer.sign(signedBodyBytes(body));
      if (keyId === expected) signed = { body, signature };
      else expected = keyId;
    }
    if (!signed) throw new Error(`the checkpoint signer answered a different key id on each of ${MAX_SIGN_ATTEMPTS} attempts`);
    this.keyId = expected;
    await this.options.engine.insert(
      AUDIT_AMENDMENT_OBJECT,
      amendmentRow(signed.body, { id: randomUUID(), signature: signed.signature }),
      { context: { isSystem: true } },
    );
    try {
      await this.options.sink?.deliver({
        kind: 'amendment',
        body: signed.body as unknown as Record<string, unknown>,
        keyId: expected,
        signature: signed.signature,
      });
    } catch (err) {
      // The amendment stays stored on the host; a sink that failed to take it never stops the expiry.
      this.options.warn(
        `AuditSealer: the checkpoint sink failed to take the expiry amendment of '${this.object}' sequences ` +
          `${first.sequence}–${last.sequence}; it stays stored on the host (${messageOf(err)})`,
      );
    }
  }

  /** The rows `taken` list, and the removal of their seeds and checkpoints, once the rows are gone. */
  private runOf(key: string, taken: readonly Taken[]): AuditExpiryRun {
    const ids = new Set<string>();
    for (const { body } of taken) for (const id of body.row_ids) ids.add(id);
    const { engine } = this.options;
    const checkpoints = this.checkpoints;
    return {
      chain: key,
      rowIds: [...ids],
      async complete() {
        // Oldest first, each seed before its checkpoint: a stop part way leaves no seed whose checkpoint is gone,
        // and the checkpoints left are this range's, which the next sweep resumes.
        for (const { stored, body } of taken) {
          await dropAuditSealSecret(engine, body.seed_handle);
          await checkpoints.delete!(AUDIT_CHECKPOINT_OBJECT, String(stored.id));
        }
      },
    };
  }
}
