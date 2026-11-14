// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { IAuditCheckpointSigner, IAuditCheckpointSink, ICryptoProvider } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import { canonicalValue, commitValue, leafHash, leafInput, type SealedFieldTypes } from './canonical.js';
import { canonicalJson } from './jcs.js';
import type { AuditSealerEngine } from './sealer.js';
import { AUDIT_AMENDMENT_OBJECT, AUDIT_CHECKPOINT_OBJECT, checkpointSeedContext, columnSaltsOf, decodeCheckpointSeed } from './seed.js';
import {
  amendmentBodyFromRow,
  amendmentRow,
  chainKeyOf,
  checkpointBodyFromRow,
  checkpointLeafHashesFromRow,
  signedBodyBytes,
  type CheckpointSignedBody,
  type RedactionAmendmentBody,
} from './signed-body.js';
import { LocalCheckpointSigner, readAuditSealSecret } from './signer.js';
import { anchoredPublicKeyOf, readAll, SigningKeyTrust } from './verifier.js';

/**
 * ADR-0154 D7 — the one redaction amendment writer. Every platform rewrite of
 * a sealed row's value column goes through it: `os migrate
 * audit-metadata-bodies`, `audit-mail-bodies` and `audit-key-material`, on the
 * hot store and on the archive datasource.
 *
 * Before a row is rewritten, {@link RedactionAmender.decide} answers one of:
 *
 *  - **`none`** — no amendment is owed: the object is not sealed, no
 *    checkpoint lists the row yet (the sealer seals the rewritten value), or
 *    the rewrite leaves every sealed commitment as it was;
 *  - **`amend`** — the row is sealed, and for each value column the rewrite
 *    changes it names the checkpoint that sealed the row, the commitment that
 *    checkpoint sealed and the commitment of the rewritten value under the same
 *    salt. {@link RedactionAmender.write} signs and stores them, and only then
 *    may the row be rewritten;
 *  - **`refused`** — the row is sealed and its amendment cannot be written: no
 *    crypto provider opens the checkpoint's seed, a checkpoint that lists it
 *    does not verify, the row no longer matches the checkpoint (so what it
 *    sealed cannot be shown), or the rewrite would change a column sealed in
 *    clear. The row is not rewritten, and the migration
 *    counts it refused.
 *
 * ⛔ Stored inputs are admitted by the verifier's own trust rule (D6,
 * `SigningKeyTrust`): a checkpoint, and a redaction amendment already written,
 * counts only when its signature verifies under a key the trust anchor
 * vouches for. A row a checkpoint that does not verify lists is refused, and
 * an amendment that does not verify is neither proof nor a reason to skip a
 * write. A checkpoint is found by the row ids it lists, never by the row's own
 * columns.
 *
 * ⛔ An amendment names a sealed commitment only once it is proven: the row's
 * leaf, rebuilt from its stored columns under the admitted checkpoint's seed
 * (and under the admitted redactions already written for it), must equal the
 * leaf hash that checkpoint signed. So a signature from this writer never
 * vouches for a value the checkpoint did not seal, and a row changed outside
 * the platform stays `modified` — it is refused here, never amended.
 *
 * A second redaction of the same column names the commitment the checkpoint
 * sealed, read from the first one, never the first rewrite's: that is what
 * the verifier rebuilds the leaf with.
 */

type Row = Record<string, unknown>;

/** Reads a stored row whole: the hot store's driver, or the archive datasource's. */
export interface SealedRowReader {
  find(object: string, query: Record<string, unknown>): Promise<Row[]>;
}

/** What a rewrite of ledger rows needs to amend a sealed row before it rewrites it (D7). */
export interface AuditRedactionSeal {
  /**
   * The engine: its registry says which objects are sealed, the checkpoints,
   * amendments, secrets and hot rows are read through its drivers, and each
   * amendment is written through it.
   */
  readonly engine: AuditSealerEngine;
  /**
   * The crypto provider `os serve` seals with: it opens each checkpoint's
   * seed, and the default signer's key. Absent, a sealed row is refused.
   */
  readonly crypto?: ICryptoProvider;
  /** A host's `audit.checkpointSigner`, when one is registered; else the default local key under `crypto`. */
  readonly signer?: IAuditCheckpointSigner & { activeKeyId?(): Promise<string | null> };
  /** A host's `audit.checkpointSink`, when one is registered: each amendment is delivered off the host too. */
  readonly sink?: IAuditCheckpointSink;
  readonly now?: () => Date;
}

/** One amendment a rewrite owes, before it is signed. */
interface RedactionDraft {
  readonly checkpoint: CheckpointSignedBody;
  readonly column: string;
  readonly sealed: string;
  readonly rewritten: string;
}

/** What {@link RedactionAmender.decide} answers for one row. */
export type RedactionDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'amend'; readonly rowId: string; readonly drafts: readonly RedactionDraft[] }
  | { readonly kind: 'refused'; readonly reason: string };

/** Sign attempts of one amendment before the writer gives up (the S1 loop of the sealer). */
const MAX_SIGN_ATTEMPTS = 3;
const NO_KEY_YET = 'unknown';
const NONE: RedactionDecision = Object.freeze({ kind: 'none' });

const messageOf = (err: unknown): string => String((err as Error)?.message ?? err);
const refused = (reason: string): RedactionDecision => ({ kind: 'refused', reason });

/** A stored checkpoint that lists a row, and its signed body. */
interface ListedCheckpoint {
  readonly stored: Row;
  readonly body: CheckpointSignedBody;
}

export class RedactionAmender {
  private sealedFields: Map<string, SealedFieldTypes> | undefined;
  private readonly listings = new Map<string, Promise<Map<string, ListedCheckpoint[]>>>();
  private trust: SigningKeyTrust | undefined;
  private signer: (IAuditCheckpointSigner & { activeKeyId?(): Promise<string | null> }) | undefined;
  private keyId: string | null = null;

  /**
   * @param migration The migration that rewrites the rows, as the amendment names it (`rewritten_by`).
   * @param logger Where a sink that failed to take an amendment is reported.
   */
  constructor(
    private readonly seal: AuditRedactionSeal,
    private readonly migration: string,
    private readonly logger?: { warn(message: string): void },
  ) {}

  /** The field types of `object` when it declares `lifecycle.seal`, else `undefined`. Read once per run. */
  private fieldsOf(object: string): SealedFieldTypes | undefined {
    if (!this.sealedFields) {
      this.sealedFields = new Map();
      for (const o of this.seal.engine.registry.getAllObjects()) {
        if ((o.lifecycle as { seal?: unknown } | undefined)?.seal) this.sealedFields.set(o.name, (o.fields ?? {}) as SealedFieldTypes);
      }
    }
    return this.sealedFields.get(object);
  }

  /** Whether rows of `object` are sealed, so that a rewrite of one must be decided first. */
  isSealed(object: string): boolean {
    return this.fieldsOf(object) !== undefined;
  }

  private async read(object: string, where: Row): Promise<Row[]> {
    const driver = this.seal.engine.getDriverForObject(object);
    if (!driver) return [];
    try {
      return await driver.find(object, { where });
    } catch (err) {
      if (isMissingTableError(err, object)) return [];
      throw err;
    }
  }

  /** The D6 trust rule this run admits signed bodies by, once there is a crypto provider to anchor it. */
  private trustOf(): SigningKeyTrust | undefined {
    const crypto = this.seal.crypto;
    if (!crypto) return undefined;
    this.trust ??= new SigningKeyTrust(anchoredPublicKeyOf(this.seal.engine, crypto, this.seal.signer));
    return this.trust;
  }

  /** Whether a stored signed body is admitted: its signature verifies under a trusted key (D6). */
  private async admits(trust: SigningKeyTrust, body: CheckpointSignedBody | RedactionAmendmentBody, stored: Row): Promise<boolean> {
    return (await trust.signature(body.signing_key_id, signedBodyBytes(body), stored.signature)) === 'ok';
  }

  /**
   * The stored checkpoints of `object`, by each row id they list: a row is
   * located by its id, never by its own `created_at` or `tenant_id`, which an
   * edit of the row can move. Read once per run, as the verifier reads them.
   */
  private listingOf(object: string): Promise<Map<string, ListedCheckpoint[]>> {
    let pending = this.listings.get(object);
    if (!pending) {
      pending = (async () => {
        const byRow = new Map<string, ListedCheckpoint[]>();
        const driver = this.seal.engine.getDriverForObject(AUDIT_CHECKPOINT_OBJECT);
        if (!driver) return byRow;
        let rows: Row[];
        try {
          rows = await readAll(driver, AUDIT_CHECKPOINT_OBJECT, { sealed_object: object });
        } catch (err) {
          if (isMissingTableError(err, AUDIT_CHECKPOINT_OBJECT)) return byRow;
          throw err;
        }
        for (const stored of rows) {
          let body: CheckpointSignedBody;
          try {
            body = checkpointBodyFromRow(stored);
          } catch {
            continue; // a malformed checkpoint holds nothing (D9)
          }
          for (const id of body.row_ids) byRow.set(id, [...(byRow.get(id) ?? []), { stored, body }]);
        }
        return byRow;
      })();
      this.listings.set(object, pending);
    }
    return pending;
  }

  /** The redaction amendments stored for row `id` of `object` that are admitted; any other is not read at all. */
  private async admittedRedactions(trust: SigningKeyTrust, object: string, id: string): Promise<RedactionAmendmentBody[]> {
    const admitted: RedactionAmendmentBody[] = [];
    for (const stored of await this.read(AUDIT_AMENDMENT_OBJECT, { row_id: id, sealed_object: object })) {
      let body;
      try {
        body = amendmentBodyFromRow(stored);
      } catch {
        continue;
      }
      if (body.kind !== 'redaction' || body.sealed_object !== object || body.row_id !== id) continue;
      if (await this.admits(trust, body, stored)) admitted.push(body);
    }
    return admitted;
  }

  /**
   * Decide what rewriting `patch` into row `id` of `object` owes (see the
   * module header). Reads only; the row is read whole from `rows`, or from the
   * hot store's driver when none is given.
   */
  async decide(object: string, id: unknown, patch: Readonly<Row>, rows?: SealedRowReader): Promise<RedactionDecision> {
    const fields = this.fieldsOf(object);
    if (!fields) return NONE;
    if (typeof id !== 'string' || id === '') return refused('the row carries no id');
    try {
      const listing = (await this.listingOf(object)).get(id) ?? [];
      // Not sealed yet: the sealer seals the rewritten value.
      if (listing.length === 0) return NONE;
      const crypto = this.seal.crypto;
      const trust = this.trustOf();
      if (!crypto || !trust) return refused('no crypto provider is available to this run, so the seed of the checkpoint that sealed it cannot be opened');
      for (const { stored, body } of listing) {
        if (!(await this.admits(trust, body, stored))) {
          return refused(`checkpoint ${body.sequence} that lists it does not verify under a trusted signing key, so what it sealed cannot be shown`);
        }
      }
      const reader = rows ?? this.seal.engine.getDriverForObject(object);
      const [row] = reader ? await reader.find(object, { where: { id }, limit: 1 }) : [];
      if (!row) return refused('the row could not be read whole, so whether it still matches its checkpoint cannot be told');
      const prior = await this.admittedRedactions(trust, object, id);
      const drafts: RedactionDraft[] = [];
      for (const { stored, body } of listing) {
        const proven = await this.proveLeaf(crypto, object, id, row, fields, stored, body, prior);
        if (typeof proven === 'string') return refused(proven);
        for (const [column, value] of Object.entries(patch)) {
          if (body.columns.clear.includes(column)) {
            const was = canonicalValue(row[column], fields[column], `${id}.${column}`);
            const now = canonicalValue(value, fields[column], `${id}.${column}`);
            if (canonicalJson(was) !== canonicalJson(now)) {
              return refused(`column '${column}' is sealed in clear, and a redaction amendment covers value columns only`);
            }
            continue;
          }
          // A column the checkpoint does not list joined the object after it was sealed (D1).
          if (!body.columns.committed.includes(column)) continue;
          const rewritten = commitValue(proven.saltOf(id, column), canonicalValue(value, fields[column], `${id}.${column}`), `${id}.${column}`);
          if (rewritten === proven.current[column]) continue;
          drafts.push({ checkpoint: body, column, sealed: proven.sealed[column] as string, rewritten });
        }
      }
      return drafts.length === 0 ? NONE : { kind: 'amend', rowId: id, drafts };
    } catch (err) {
      return refused(messageOf(err));
    }
  }

  /**
   * The row's leaf under the admitted checkpoint `body`, rebuilt and matched
   * against the leaf hash it signed, under the admitted redactions of the
   * row: the current commitments, the commitments it sealed, and the salts;
   * or why it does not match.
   */
  private async proveLeaf(
    crypto: ICryptoProvider,
    object: string,
    id: string,
    row: Row,
    fields: SealedFieldTypes,
    stored: Row,
    body: CheckpointSignedBody,
    prior: readonly RedactionAmendmentBody[],
  ): Promise<{ current: Row; sealed: Row; saltOf: (rowId: string, column: string) => Buffer } | string> {
    const hashes = checkpointLeafHashesFromRow(stored, body);
    const handle = await readAuditSealSecret(this.seal.engine, body.seed_handle);
    if (!handle) return `the seed of checkpoint ${body.sequence} that sealed it is missing`;
    let seed: Buffer;
    try {
      seed = decodeCheckpointSeed(await crypto.decrypt(handle, checkpointSeedContext(object, body.tenant_id, body.sequence)));
    } catch (err) {
      return `the seed of checkpoint ${body.sequence} that sealed it does not open (${messageOf(err)})`;
    }
    const saltOf = columnSaltsOf(seed, object);
    const current = leafInput(row, body.columns, fields, saltOf);
    // The admitted redactions of this row: a column holding the commitment one rewrote to sealed the one it names.
    const sealed: Row = { ...current };
    for (const amendment of prior) {
      if (amendment.checkpoint_sequence !== body.sequence || chainKeyOf(amendment.tenant_id) !== chainKeyOf(body.tenant_id)) continue;
      if (!body.columns.committed.includes(amendment.column_name)) continue;
      if (current[amendment.column_name] === amendment.rewritten_commitment) sealed[amendment.column_name] = amendment.sealed_commitment;
    }
    if (leafHash(sealed).toString('hex') !== hashes[body.row_ids.indexOf(id)]) {
      return `it no longer matches checkpoint ${body.sequence} that sealed it, so the value that checkpoint sealed cannot be shown`;
    }
    return { current, sealed, saltOf };
  }

  /**
   * Sign and store the amendments a decision owes, before the row is
   * rewritten. Throws when one cannot be written: the row must then be left as
   * it is. An admitted amendment already stored for the same rewrite is not
   * written twice; a stored one that is not admitted is not one.
   */
  async write(object: string, decision: RedactionDecision): Promise<void> {
    if (decision.kind !== 'amend') return;
    const { engine, crypto } = this.seal;
    if (!this.signer) {
      this.signer = this.seal.signer ?? (crypto ? new LocalCheckpointSigner({ engine, crypto }) : undefined);
    }
    const signer = this.signer;
    const trust = this.trustOf();
    if (!signer || !trust) throw new Error('no checkpoint signer is available to this run');
    const stored = await this.admittedRedactions(trust, object, decision.rowId);
    for (const draft of decision.drafts) {
      const done = stored.some((a) => a.column_name === draft.column && a.checkpoint_sequence === draft.checkpoint.sequence
        && chainKeyOf(a.tenant_id) === chainKeyOf(draft.checkpoint.tenant_id)
        && a.sealed_commitment === draft.sealed && a.rewritten_commitment === draft.rewritten);
      if (done) continue;
      const amendedAt = (this.seal.now?.() ?? new Date()).toISOString();
      const build = (signingKeyId: string): RedactionAmendmentBody => ({
        kind: 'redaction',
        sealed_object: object,
        tenant_id: draft.checkpoint.tenant_id,
        amended_at: amendedAt,
        signing_key_id: signingKeyId,
        checkpoint_sequence: draft.checkpoint.sequence,
        row_id: decision.rowId,
        column_name: draft.column,
        sealed_commitment: draft.sealed,
        rewritten_commitment: draft.rewritten,
        rewritten_by: this.migration,
      });
      // The S1 loop: a signature whose key id differs from the one its bytes name is never stored.
      let expected = this.keyId ?? (await signer.activeKeyId?.()) ?? NO_KEY_YET;
      let signed: { body: RedactionAmendmentBody; signature: string } | undefined;
      for (let attempt = 0; attempt < MAX_SIGN_ATTEMPTS && !signed; attempt++) {
        const body = build(expected);
        const { keyId, signature } = await signer.sign(signedBodyBytes(body));
        if (keyId === expected) signed = { body, signature };
        else expected = keyId;
      }
      if (!signed) throw new Error(`the checkpoint signer answered a different key id on each of ${MAX_SIGN_ATTEMPTS} attempts`);
      this.keyId = expected;
      await this.seal.engine.insert(AUDIT_AMENDMENT_OBJECT, amendmentRow(signed.body, { id: randomUUID(), signature: signed.signature }), { context: { isSystem: true } });
      try {
        await this.seal.sink?.deliver({ kind: 'amendment', body: signed.body as unknown as Record<string, unknown>, keyId: expected, signature: signed.signature });
      } catch (err) {
        // The amendment stays stored on the host; a sink that failed to take it never stops the rewrite.
        this.logger?.warn(`the checkpoint sink failed to take the redaction amendment of ${object}/${decision.rowId}; it stays stored on the host (${messageOf(err)})`);
      }
    }
  }
}
