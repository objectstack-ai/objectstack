// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { parseLifecycleDuration } from '@objectstack/objectql';
import type { IAuditCheckpointSigner, ICryptoProvider } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import { canonicalDatetime, canonicalValue, commitValue, leafHash, leafInput, rowIdOf, type ColumnSaltOf, type SealedFieldTypes } from './canonical.js';
import { AUDIT_AMENDMENT_OBJECT, AUDIT_CHECKPOINT_OBJECT, checkpointSeedContext, columnSaltsOf, decodeCheckpointSeed } from './seed.js';
import { AUDIT_SEAL_WINDOW_MS } from './sealer.js';
import {
  amendmentBodyFromRow,
  chainKeyOf,
  checkpointBodyFromRow,
  checkpointDigest,
  checkpointLeafHashesFromRow,
  signedBodyBytes,
  type CheckpointSignedBody,
  type ExpiryAmendmentBody,
  type RedactionAmendmentBody,
} from './signed-body.js';
import { readAuditSealSecret, trustedSigningKey, type SealStorageDriver, type SealStorageReader } from './signer.js';

/**
 * ADR-0154 D9 — the live check of `os audit verify`: every chain of every
 * sealed object, read from the hot store and the archive datasource, judged
 * against the trusted signing keys only.
 *
 * Trust. A signing key is trusted only when the trust anchor vouches for it
 * (D6: the local anchor derives the public half from the wrapped private half,
 * never reads it off a row). A checkpoint signed under any other key, or whose
 * signature does not verify, holds nothing.
 *
 * Per chain (object × organization, or × the deployment):
 *
 *  - **Links**, over the whole chain whatever `from`/`to` say: every sequence
 *    from 0 is held by a checkpoint or covered by an honoured expiry (D8), and
 *    each checkpoint's `previous_digest` is the digest of the one before it
 *    (or the `last_removed_digest` of the expiry right before it).
 *  - **Rows**, in the windows `from`/`to` overlap. A checkpoint holds its rows
 *    only when its signature verifies under a trusted key, its stored
 *    `leaf_hashes` rebuild its signed root, and its seed opens. Each row it
 *    lists is then judged against its own leaf hash: `unmodified` (`late` for
 *    a `late` checkpoint), `redacted` when an honoured D7 amendment rebuilds
 *    the sealed leaf, `modified`, or `missing` when neither store holds it.
 *    Rows that checkpoints inside an honoured expiry list read `expired`.
 *  - **Rows no checkpoint holds.** A row of a sealed window that no trusted
 *    checkpoint lists, or that only a checkpoint holding nothing lists, is
 *    `late` and unsealed: on the host it cannot be told from a forged insert.
 *    A window is sealed once a trusted `window` checkpoint of the object names
 *    it, or it ends at or before the object's highest trusted
 *    `sealed_through`.
 *
 * The report passes ({@link AuditVerifyReport.ok}) when no chain fault was
 * found and no row is `modified`, `missing` or `late` unsealed. Nothing here
 * writes; every read is a driver read, below the hooks.
 */

/** The six verdicts of D9, closed. */
export const AUDIT_ROW_VERDICTS = ['unmodified', 'modified', 'missing', 'late', 'redacted', 'expired'] as const;
export type AuditRowVerdict = (typeof AUDIT_ROW_VERDICTS)[number];

/** What failed in a chain: each one fails the run. */
export type AuditChainFaultCode =
  /** A checkpoint or amendment row that is not a valid signed body. */
  | 'malformed'
  /** Signed under a key the trust anchor does not vouch for. */
  | 'untrusted_key'
  /** A signature that does not verify under its trusted key. */
  | 'signature'
  /** The stored `chain_key` disagrees with the signed `tenant_id`. */
  | 'chain_key'
  /** Two checkpoints at one sequence of one chain. */
  | 'duplicate'
  /** Sequences no checkpoint holds and no honoured expiry covers. */
  | 'gap'
  /** A `previous_digest` that is not the digest of what precedes it. */
  | 'link'
  /** An expiry amendment that is not honoured (D8). */
  | 'expiry'
  /** Stored leaf hashes that do not rebuild the signed root. */
  | 'leaf_hashes'
  /** A checkpoint seed that is missing or will not open. */
  | 'seed';

export interface AuditChainFault {
  readonly object: string;
  /** The chain: `org:<id>`, or `deployment`. */
  readonly chain: string;
  readonly code: AuditChainFaultCode;
  /** The checkpoint's sequence, when the fault is one checkpoint's. */
  readonly sequence?: number;
  /** The amendment row's id, when the fault is one amendment's. */
  readonly amendment?: string;
  readonly message: string;
}

/** A row that is not `unmodified`. */
export interface AuditRowFinding {
  readonly object: string;
  readonly chain: string;
  readonly row: string;
  readonly verdict: Exclude<AuditRowVerdict, 'unmodified'>;
  /** `false` only for a `late` row no trusted checkpoint holds; such a row fails the run. */
  readonly sealed: boolean;
  /** The sequence of the checkpoint that judged it; `null` for an unsealed row. */
  readonly sequence: number | null;
}

/** Rows per verdict; `unsealed` counts the `late` rows no trusted checkpoint holds (a subset of `late`). */
export type AuditVerdictCounts = Record<AuditRowVerdict, number> & { unsealed: number };

export interface AuditChainReport {
  readonly object: string;
  readonly chain: string;
  /** In-scope checkpoints the chain stores. */
  readonly checkpoints: number;
  readonly counts: AuditVerdictCounts;
}

/** A redaction amendment whose rewrite never landed: the row still holds the sealed value (D7). */
export interface AuditDanglingRedaction {
  readonly object: string;
  readonly chain: string;
  readonly amendment: string;
  readonly row: string;
  readonly column: string;
  readonly sequence: number;
}

export interface AuditVerifyReport {
  /** No chain fault, and no row `modified`, `missing` or `late` unsealed: exit 0 (D9). */
  readonly ok: boolean;
  /** `false` when no object declares `seal` and no checkpoint is stored: there is nothing to check. */
  readonly sealed: boolean;
  readonly checked_at: string;
  readonly scope: { readonly orgs: readonly string[] | null; readonly from: string | null; readonly to: string | null };
  /** The sealed objects checked. */
  readonly objects: readonly string[];
  /** Fingerprints of the signing keys records named: those the anchor vouched for, and those it did not. */
  readonly keys: { readonly trusted: readonly string[]; readonly untrusted: readonly string[] };
  readonly totals: AuditVerdictCounts;
  readonly chains: readonly AuditChainReport[];
  /** Every row that is not `unmodified`. */
  readonly rows: readonly AuditRowFinding[];
  readonly faults: readonly AuditChainFault[];
  readonly dangling: readonly AuditDanglingRedaction[];
}

/** The engine surface the verifier reads: the registry, a driver per object, the archive datasource. */
export interface AuditVerifierEngine extends SealStorageReader {
  registry: { getAllObjects(): ReadonlyArray<{ name: string; fields?: unknown; lifecycle?: unknown }> };
  datasource?(name: string): SealStorageDriver | undefined;
}

export interface AuditVerifyOptions {
  engine: AuditVerifierEngine;
  /** Opens the checkpoint seeds, and the signing keys' private halves for the default anchor. */
  crypto: ICryptoProvider;
  /** The trust anchor. Default: the local signer's (D6), {@link trustedSigningKey}. */
  trust?: Pick<IAuditCheckpointSigner, 'trustedPublicKey'>;
  /** Organization chains to check; absent, every chain, the deployment chain included. */
  orgs?: readonly string[];
  /** Judge only the rows of the windows `[from, to)` overlaps. Links and signatures are checked whole. */
  from?: Date;
  to?: Date;
  /**
   * The archive datasource a sealed object declares (`lifecycle.archive.to`),
   * resolved: its driver, or `'none'` when the caller established that no
   * datasource of that name exists anywhere — nothing was ever archived, so
   * the hot store alone is read. Default: `engine.datasource(name)`. Anything
   * else (a datasource that exists and this boot did not reach) throws: every
   * archived row would read `missing`.
   */
  archive?: (datasource: string, object: string) => SealStorageDriver | 'none' | undefined;
  now?: () => number;
}

type Row = Record<string, unknown>;

const PAGE_SIZE = 500;
const iso = (ms: number): string => new Date(ms).toISOString();
const windowOf = (ms: number): number => Math.floor(ms / AUDIT_SEAL_WINDOW_MS) * AUDIT_SEAL_WINDOW_MS;
const tenantOf = (row: Row): string | null => (typeof row.tenant_id === 'string' && row.tenant_id !== '' ? row.tenant_id : null);
const zero = (): AuditVerdictCounts => ({ unmodified: 0, modified: 0, missing: 0, late: 0, redacted: 0, expired: 0, unsealed: 0 });
const messageOf = (err: unknown): string => String((err as Error)?.message ?? err);

/** A checkpoint as the link pass keeps it: its signed coordinates, not its row lists. */
interface CheckpointHead {
  readonly id: string;
  readonly chain: string;
  readonly sequence: number;
  readonly kind: CheckpointSignedBody['kind'];
  readonly windowStart: number;
  readonly digest: string;
  readonly previousDigest: string | null;
  /** Whether it can hold rows so far: a valid signature under a trusted key, at a sequence no other takes. */
  holds: boolean;
}

/** One verified signature check: the key it named was vouched for and the signature holds. */
type SignatureVerdict = 'ok' | 'untrusted_key' | 'signature';

/** Run the live check. Throws when a sealed object's archive datasource is not reachable on this boot. */
export async function verifyAuditLedger(options: AuditVerifyOptions): Promise<AuditVerifyReport> {
  return new LedgerCheck(options).run();
}

class LedgerCheck {
  private readonly now: number;
  private readonly orgs: ReadonlySet<string> | null;
  private readonly rangeLo: number;
  private readonly rangeHi: number;
  private readonly keys = new Map<string, KeyObject | null>();
  private readonly faults: AuditChainFault[] = [];
  private readonly findings: AuditRowFinding[] = [];
  private readonly dangling: AuditDanglingRedaction[] = [];
  private readonly chains = new Map<string, { object: string; chain: string; checkpoints: number; counts: AuditVerdictCounts }>();

  constructor(private readonly options: AuditVerifyOptions) {
    this.now = (options.now ?? Date.now)();
    this.orgs = options.orgs ? new Set(options.orgs) : null;
    // The windows `[from, to)` overlaps, as whole windows.
    this.rangeLo = options.from ? windowOf(options.from.getTime()) : Number.NEGATIVE_INFINITY;
    this.rangeHi = options.to ? windowOf(options.to.getTime() - 1) + AUDIT_SEAL_WINDOW_MS : Number.POSITIVE_INFINITY;
  }

  async run(): Promise<AuditVerifyReport> {
    const objects = this.options.engine.registry.getAllObjects();
    const amendmentsRegistered = objects.some((o) => o.name === AUDIT_AMENDMENT_OBJECT);
    const sealed: string[] = [];
    for (const object of objects) {
      const declares = Boolean((object.lifecycle as { seal?: unknown } | undefined)?.seal);
      if (declares || (await this.hasCheckpoints(object.name))) sealed.push(object.name);
    }
    for (const name of sealed) {
      const object = objects.find((o) => o.name === name)!;
      await new ObjectCheck(this, object, amendmentsRegistered).run();
    }
    const chains = [...this.chains.values()].sort((a, b) => (a.object === b.object ? cmp(a.chain, b.chain) : cmp(a.object, b.object)));
    const totals = zero();
    for (const chain of chains) for (const k of Object.keys(totals) as Array<keyof AuditVerdictCounts>) totals[k] += chain.counts[k];
    const trusted = [...this.keys].filter(([, key]) => key !== null).map(([id]) => id).sort();
    const untrusted = [...this.keys].filter(([, key]) => key === null).map(([id]) => id).sort();
    return {
      ok: this.faults.length === 0 && totals.modified === 0 && totals.missing === 0 && totals.unsealed === 0,
      sealed: sealed.length > 0,
      checked_at: iso(this.now),
      scope: {
        orgs: this.options.orgs ? [...this.options.orgs] : null,
        from: this.options.from ? this.options.from.toISOString() : null,
        to: this.options.to ? this.options.to.toISOString() : null,
      },
      objects: sealed,
      keys: { trusted, untrusted },
      totals,
      chains,
      rows: this.findings,
      faults: this.faults,
      dangling: this.dangling,
    };
  }

  // ── shared by every object ────────────────────────────────────────────────

  get engine(): AuditVerifierEngine {
    return this.options.engine;
  }

  get crypto(): ICryptoProvider {
    return this.options.crypto;
  }

  get checkTime(): number {
    return this.now;
  }

  /** The archive store of `object`, `null` when there is none to read; throws when one exists out of reach. */
  archiveOf(datasource: string, object: string): SealStorageDriver | null {
    let resolved: SealStorageDriver | 'none' | undefined;
    try {
      resolved = this.options.archive ? this.options.archive(datasource, object) : this.options.engine.datasource?.(datasource);
    } catch {
      resolved = undefined;
    }
    if (resolved === 'none') return null;
    if (!resolved) {
      throw new Error(
        `'${object}' archives to datasource '${datasource}', which this boot did not connect: its archived rows cannot be read, ` +
          'so no verdict is given (each would read missing). Connect that datasource and run the check again.',
      );
    }
    return resolved;
  }

  inScope(chain: string): boolean {
    if (this.orgs === null) return true;
    return chain.startsWith('org:') && this.orgs.has(chain.slice(4));
  }

  inRange(windowStart: number): boolean {
    return windowStart >= this.rangeLo && windowStart < this.rangeHi;
  }

  get rowRangeLo(): number {
    return this.rangeLo;
  }

  get rowRangeHi(): number {
    return this.rangeHi;
  }

  chain(object: string, chain: string) {
    const key = `${object}\u0000${chain}`;
    let entry = this.chains.get(key);
    if (!entry) {
      entry = { object, chain, checkpoints: 0, counts: zero() };
      this.chains.set(key, entry);
    }
    return entry;
  }

  fault(fault: AuditChainFault): void {
    if (this.inScope(fault.chain)) this.faults.push(fault);
  }

  judge(finding: AuditRowFinding | { object: string; chain: string; verdict: 'unmodified' }): void {
    const counts = this.chain(finding.object, finding.chain).counts;
    counts[finding.verdict] += 1;
    if (finding.verdict === 'unmodified') return;
    if (!finding.sealed) counts.unsealed += 1;
    this.findings.push(finding);
  }

  danglingRedaction(entry: AuditDanglingRedaction): void {
    this.dangling.push(entry);
  }

  /** Whether `signature` over `bytes` verifies under signing key `keyId`, as the trust anchor vouches for it. */
  async signature(keyId: string, bytes: Uint8Array, signature: unknown): Promise<SignatureVerdict> {
    const key = await this.trustedKey(keyId);
    if (!key) return 'untrusted_key';
    if (typeof signature !== 'string' || signature === '') return 'signature';
    try {
      return verify(null, bytes, key, Buffer.from(signature, 'base64')) ? 'ok' : 'signature';
    } catch {
      return 'signature';
    }
  }

  private async trustedKey(keyId: string): Promise<KeyObject | null> {
    if (this.keys.has(keyId)) return this.keys.get(keyId)!;
    let publicKey: string | null;
    try {
      publicKey = this.options.trust
        ? await this.options.trust.trustedPublicKey(keyId)
        : await trustedSigningKey(this.options.engine, this.options.crypto, keyId);
    } catch (err) {
      // No key table is no key; any other read fault stops the run rather than reading as tampering.
      if (!isMissingTableError(err)) throw err;
      publicKey = null;
    }
    let key: KeyObject | null = null;
    if (publicKey !== null) {
      try {
        key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'base64').toString('base64url') }, format: 'jwk' });
      } catch {
        key = null;
      }
    }
    this.keys.set(keyId, key);
    return key;
  }

  private async hasCheckpoints(object: string): Promise<boolean> {
    const driver = this.options.engine.getDriverForObject(AUDIT_CHECKPOINT_OBJECT);
    if (!driver) return false;
    try {
      return (await driver.find(AUDIT_CHECKPOINT_OBJECT, { where: { sealed_object: object }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1 })).length > 0;
    } catch (err) {
      if (isMissingTableError(err, AUDIT_CHECKPOINT_OBJECT)) return false;
      throw err;
    }
  }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const kindOrder = (kind: CheckpointSignedBody['kind']): number => (kind === 'window' ? 0 : 1);

/** Every row of `object` a driver holds that `where` matches, in id order, page by page. */
async function readAll(driver: SealStorageDriver, object: string, where: Row): Promise<Row[]> {
  const rows: Row[] = [];
  for (let after: unknown; ;) {
    const page = await driver.find(object, {
      where: after === undefined ? where : { $and: [where, { id: { $gt: after } }] },
      orderBy: [{ field: 'id', order: 'asc' }],
      limit: PAGE_SIZE,
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    after = page[page.length - 1].id;
  }
}

/** One sealed object's chains and rows. */
class ObjectCheck {
  private readonly name: string;
  private readonly types: SealedFieldTypes;
  private readonly hot: SealStorageDriver;
  private readonly archive: SealStorageDriver | undefined;
  private readonly heads = new Map<string, CheckpointHead>();
  /** Honoured expiries by chain, in sequence order (D8). */
  private readonly honoured = new Map<string, ExpiryAmendmentBody[]>();
  /** Trusted redactions by chain, checkpoint sequence and row (D7). */
  private readonly redactions = new Map<string, Array<RedactionAmendmentBody & { id: string }>>();
  /** The object's highest trusted `sealed_through`, and the windows a trusted `window` checkpoint names. */
  private watermark = Number.NEGATIVE_INFINITY;
  private readonly sealedWindows = new Set<number>();
  /** Rows a checkpoint holds, and rows only a checkpoint holding nothing lists. */
  private readonly held = new Set<string>();
  private readonly listedByFaulted = new Set<string>();
  private readonly unheld = new Map<string, { chain: string; windowStart: number }>();

  constructor(
    private readonly check: LedgerCheck,
    object: { name: string; fields?: unknown; lifecycle?: unknown },
    private readonly amendmentsRegistered: boolean,
  ) {
    this.name = object.name;
    this.types = (object.fields ?? {}) as SealedFieldTypes;
    const { engine } = check;
    const hot = engine.getDriverForObject(object.name);
    if (!hot) throw new Error(`no driver resolves for '${object.name}'`);
    this.hot = hot;
    const to = (object.lifecycle as { archive?: { to?: unknown } } | undefined)?.archive?.to;
    const archive = typeof to === 'string' && to !== '' ? check.archiveOf(to, object.name) : null;
    this.archive = archive && archive !== hot ? archive : undefined;
  }

  private key(chain: string, sequence: number): string {
    return `${chain}\u0000${sequence}`;
  }

  async run(): Promise<void> {
    await this.readCheckpoints();
    await this.readAmendments();
    this.checkLinks();
    await this.judgeRows();
  }

  // ── chains: signatures and links ──────────────────────────────────────────

  private checkpointDriver(): SealStorageDriver | undefined {
    return this.check.engine.getDriverForObject(AUDIT_CHECKPOINT_OBJECT);
  }

  private async readCheckpoints(): Promise<void> {
    const driver = this.checkpointDriver();
    if (!driver) return;
    let rows: Row[];
    try {
      rows = await readAll(driver, AUDIT_CHECKPOINT_OBJECT, { sealed_object: this.name });
    } catch (err) {
      if (isMissingTableError(err, AUDIT_CHECKPOINT_OBJECT)) return;
      throw err;
    }
    const taken = new Map<string, CheckpointHead>();
    for (const row of rows) {
      let body: CheckpointSignedBody;
      try {
        body = checkpointBodyFromRow(row);
      } catch (err) {
        this.check.fault({ object: this.name, chain: String(row.chain_key ?? '?'), code: 'malformed', message: `checkpoint ${String(row.id)}: ${messageOf(err)}` });
        continue;
      }
      const chain = chainKeyOf(body.tenant_id);
      if (this.check.inScope(chain)) this.check.chain(this.name, chain).checkpoints += 1;
      if (row.chain_key !== chain) {
        this.check.fault({
          object: this.name, chain, code: 'chain_key', sequence: body.sequence,
          message: `checkpoint ${body.sequence}: stored under chain '${String(row.chain_key)}', but its signed organization is chain '${chain}'`,
        });
      }
      const signed = await this.check.signature(body.signing_key_id, signedBodyBytes(body), row.signature);
      if (signed !== 'ok') {
        this.check.fault({
          object: this.name, chain, code: signed, sequence: body.sequence,
          message: signed === 'untrusted_key'
            ? `checkpoint ${body.sequence}: signed under key ${body.signing_key_id}, which no trusted key matches — it holds nothing`
            : `checkpoint ${body.sequence}: its signature does not verify under key ${body.signing_key_id} — it holds nothing`,
        });
      }
      const head: CheckpointHead = {
        id: String(row.id),
        chain,
        sequence: body.sequence,
        kind: body.kind,
        windowStart: Date.parse(body.window_start),
        digest: checkpointDigest(body),
        previousDigest: body.previous_digest,
        holds: signed === 'ok',
      };
      const twin = taken.get(this.key(chain, body.sequence));
      if (twin) {
        twin.holds = false;
        head.holds = false;
        this.check.fault({ object: this.name, chain, code: 'duplicate', sequence: body.sequence, message: `checkpoint ${body.sequence}: two checkpoints take this sequence — neither holds anything` });
      } else {
        taken.set(this.key(chain, body.sequence), head);
      }
      this.heads.set(head.id, head);
      if (signed === 'ok') {
        this.watermark = Math.max(this.watermark, Date.parse(body.sealed_through));
        if (body.kind === 'window') this.sealedWindows.add(head.windowStart);
      }
    }
  }

  private async readAmendments(): Promise<void> {
    // [P3] `sys_audit_amendment` is registered with its writers; until then there is none to read.
    if (!this.amendmentsRegistered) return;
    const driver = this.check.engine.getDriverForObject(AUDIT_AMENDMENT_OBJECT);
    if (!driver) return;
    let rows: Row[];
    try {
      rows = await readAll(driver, AUDIT_AMENDMENT_OBJECT, { sealed_object: this.name });
    } catch (err) {
      if (isMissingTableError(err, AUDIT_AMENDMENT_OBJECT)) return;
      throw err;
    }
    const expiries = new Map<string, ExpiryAmendmentBody[]>();
    for (const row of rows) {
      let body;
      try {
        body = amendmentBodyFromRow(row);
      } catch (err) {
        this.check.fault({ object: this.name, chain: String(row.chain_key ?? '?'), code: 'malformed', amendment: String(row.id), message: `amendment ${String(row.id)}: ${messageOf(err)}` });
        continue;
      }
      const chain = chainKeyOf(body.tenant_id);
      const signed = await this.check.signature(body.signing_key_id, signedBodyBytes(body), row.signature);
      if (signed !== 'ok') {
        // An amendment nothing vouches for is ignored: the row it would explain reads as what it is.
        this.check.fault({
          object: this.name, chain, code: signed, amendment: String(row.id),
          message: `${body.kind} amendment ${String(row.id)}: ${signed === 'untrusted_key' ? `signed under key ${body.signing_key_id}, which no trusted key matches` : 'its signature does not verify'} — it is ignored`,
        });
        continue;
      }
      if (body.kind === 'expiry') expiries.set(chain, [...(expiries.get(chain) ?? []), body]);
      else this.redactions.set(this.key(chain, body.checkpoint_sequence), [...(this.redactions.get(this.key(chain, body.checkpoint_sequence)) ?? []), { ...body, id: String(row.id) }]);
    }
    for (const [chain, list] of expiries) this.honour(chain, list.sort((a, b) => a.first_sequence - b.first_sequence));
  }

  /**
   * D8: an expiry is honoured only when its range starts at the chain's first
   * sequence or directly after an honoured expiry, and every window it covers
   * ended before the check's time minus the `keep` its own signed body
   * carries. The object's current declaration is never read.
   */
  private honour(chain: string, expiries: ExpiryAmendmentBody[]): void {
    const honoured: ExpiryAmendmentBody[] = [];
    let next = 0;
    for (const expiry of expiries) {
      let reason: string | null = null;
      let keep: number | null = null;
      try {
        keep = parseLifecycleDuration(expiry.policy_value);
      } catch {
        reason = `its policy value '${expiry.policy_value}' is not a duration`;
      }
      if (reason === null && expiry.first_sequence !== next) {
        reason = `it starts at sequence ${expiry.first_sequence}, not at ${next} (the chain's first, or the one after the last honoured expiry)`;
      } else if (reason === null && Date.parse(expiry.covered_to) > this.check.checkTime - keep!) {
        reason = `its windows end ${expiry.covered_to}, later than ${expiry.policy} ${expiry.policy_value} before the check`;
      }
      if (reason !== null) {
        this.check.fault({
          object: this.name, chain, code: 'expiry',
          message: `expiry of sequences ${expiry.first_sequence}–${expiry.last_sequence} is not honoured: ${reason} — the range reads missing`,
        });
        continue;
      }
      honoured.push(expiry);
      next = expiry.last_sequence + 1;
    }
    this.honoured.set(chain, honoured);
  }

  private expiryCovering(chain: string, sequence: number): ExpiryAmendmentBody | undefined {
    return this.honoured.get(chain)?.find((e) => sequence >= e.first_sequence && sequence <= e.last_sequence);
  }

  private checkLinks(): void {
    const byChain = new Map<string, Map<number, CheckpointHead>>();
    for (const head of this.heads.values()) {
      if (!byChain.has(head.chain)) byChain.set(head.chain, new Map());
      const seqs = byChain.get(head.chain)!;
      if (!seqs.has(head.sequence)) seqs.set(head.sequence, head);
    }
    for (const chain of this.honoured.keys()) if (!byChain.has(chain)) byChain.set(chain, new Map());
    for (const [chain, seqs] of byChain) {
      if (!this.check.inScope(chain)) continue;
      const honoured = this.honoured.get(chain) ?? [];
      const last = Math.max(-1, ...seqs.keys(), ...honoured.map((e) => e.last_sequence));
      // Every sequence from 0 is held by a checkpoint or covered by an honoured expiry.
      for (let s = 0; s <= last; s++) {
        if (seqs.has(s) || this.expiryCovering(chain, s)) continue;
        let end = s;
        while (end + 1 <= last && !seqs.has(end + 1) && !this.expiryCovering(chain, end + 1)) end += 1;
        this.check.fault({
          object: this.name, chain, code: 'gap', sequence: s,
          message: `${s === end ? `sequence ${s}` : `sequences ${s}–${end}`}: no checkpoint holds it and no honoured expiry covers it — its rows are missing`,
        });
        s = end;
      }
      for (const head of seqs.values()) {
        if (head.sequence === 0 || this.expiryCovering(chain, head.sequence)) continue;
        const bridge = honoured.find((e) => e.last_sequence === head.sequence - 1);
        const expected = bridge ? bridge.last_removed_digest : seqs.get(head.sequence - 1)?.digest;
        if (expected === undefined) continue; // the gap is reported above
        if (head.previousDigest !== expected) {
          this.check.fault({
            object: this.name, chain, code: 'link', sequence: head.sequence,
            message: `checkpoint ${head.sequence}: its previous_digest is not the digest of ${bridge ? `the expiry ending at ${bridge.last_sequence}` : `checkpoint ${head.sequence - 1}`}`,
          });
        }
      }
    }
  }

  // ── rows ──────────────────────────────────────────────────────────────────

  private stores(): SealStorageDriver[] {
    return this.archive ? [this.hot, this.archive] : [this.hot];
  }

  /** A store's rows of this object, or none when its table does not exist: every listed row then reads missing. */
  private async find(store: SealStorageDriver, query: Row): Promise<Row[]> {
    try {
      return await store.find(this.name, query);
    } catch (err) {
      if (isMissingTableError(err, this.name)) return [];
      throw err;
    }
  }

  private async rowById(id: string): Promise<Row | undefined> {
    for (const store of this.stores()) {
      // Ordered, so a driver that did not create the table (an archive) reads it deterministically.
      const [row] = await this.find(store, { where: { id }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1 });
      if (row) return row;
    }
    return undefined;
  }

  /** The earliest `created_at` in `[from, to)` across the stores, as epoch ms. */
  private async firstRowAt(from: number, to: number): Promise<number | null> {
    let first: number | null = null;
    const range: Row = Number.isFinite(from) ? { $gte: iso(from), $lt: iso(to) } : { $lt: iso(to) };
    for (const store of this.stores()) {
      const [row] = await this.find(store, { where: { created_at: range }, orderBy: [{ field: 'created_at', order: 'asc' }], limit: 1 });
      if (!row) continue;
      const at = Date.parse(canonicalDatetime(row.created_at, `${rowIdOf(row)}.created_at`));
      if (first === null || at < first) first = at;
    }
    return first;
  }

  /** The rows of window `start` in the stores, each once, keyed by id; a row whose window is another is left out. */
  private async windowRows(start: number): Promise<Map<string, Row>> {
    const rows = new Map<string, Row>();
    const range = { created_at: { $gte: iso(start), $lt: iso(start + AUDIT_SEAL_WINDOW_MS) } };
    for (const store of this.stores()) {
      // Keyset paging on (created_at, id), as the sealer reads (S2).
      for (let after: Row | undefined; ;) {
        const page = await this.find(store, {
          where: after === undefined ? range : { $and: [range, { $or: [
            { created_at: { $gt: after.created_at } },
            { $and: [{ created_at: after.created_at }, { id: { $gt: after.id } }] },
          ] }] },
          orderBy: [{ field: 'created_at', order: 'asc' }, { field: 'id', order: 'asc' }],
          limit: PAGE_SIZE,
        });
        for (const row of page) {
          const id = rowIdOf(row);
          if (rows.has(id)) continue;
          let window = start;
          try {
            window = windowOf(Date.parse(canonicalDatetime(row.created_at, `${id}.created_at`)));
          } catch {
            /* an unreadable created_at is judged in the window the store placed it in */
          }
          if (window === start) rows.set(id, row);
        }
        if (page.length < PAGE_SIZE) break;
        after = page[page.length - 1];
      }
    }
    return rows;
  }

  private async judgeRows(): Promise<void> {
    const inScopeWindows = [...new Set([...this.heads.values()]
      .filter((h) => this.check.inScope(h.chain) && this.check.inRange(h.windowStart))
      .map((h) => h.windowStart))].sort((a, b) => a - b);
    // Rows are read up to the last window sealed; a row after it is not yet due, and has no verdict.
    let sealedEnd = this.watermark;
    for (const start of this.sealedWindows) sealedEnd = Math.max(sealedEnd, start + AUDIT_SEAL_WINDOW_MS);
    const rowsTo = Math.min(sealedEnd, this.check.rowRangeHi);
    let cursor = this.check.rowRangeLo;
    let w = 0;
    for (;;) {
      while (w < inScopeWindows.length && inScopeWindows[w] < cursor) w += 1;
      const nextCheckpoint = w < inScopeWindows.length ? inScopeWindows[w] : null;
      const nextRow = Number.isFinite(rowsTo) && cursor < rowsTo ? await this.firstRowAt(cursor, rowsTo) : null;
      const candidates = [nextCheckpoint, nextRow === null ? null : windowOf(nextRow)].filter((v): v is number => v !== null);
      if (candidates.length === 0) break;
      const start = Math.min(...candidates);
      await this.judgeWindow(start);
      cursor = start + AUDIT_SEAL_WINDOW_MS;
    }
    for (const [id, { chain }] of this.unheld) {
      if (this.held.has(id)) continue; // listed by a checkpoint of another window (its created_at moved)
      this.check.judge({ object: this.name, chain, row: id, verdict: 'late', sealed: false, sequence: null });
    }
  }

  private async judgeWindow(start: number): Promise<void> {
    const rows = await this.windowRows(start);
    const driver = this.checkpointDriver();
    let checkpoints: Row[] = [];
    if (driver) {
      try {
        checkpoints = await driver.find(AUDIT_CHECKPOINT_OBJECT, {
          where: { sealed_object: this.name, window_start: { $gte: iso(start), $lt: iso(start + AUDIT_SEAL_WINDOW_MS) } },
        });
      } catch (err) {
        if (!isMissingTableError(err, AUDIT_CHECKPOINT_OBJECT)) throw err;
      }
    }
    // Window checkpoints before late ones, each chain in sequence order.
    const ordered = checkpoints
      .map((row) => ({ row, head: this.heads.get(String(row.id)) }))
      .filter((c): c is { row: Row; head: CheckpointHead } => c.head !== undefined && this.check.inScope(c.head.chain))
      .sort((a, b) => kindOrder(a.head.kind) - kindOrder(b.head.kind) || cmp(a.head.chain, b.head.chain) || a.head.sequence - b.head.sequence);
    for (const { row, head } of ordered) await this.judgeCheckpoint(row, head, rows);
    const sealedWindow = start + AUDIT_SEAL_WINDOW_MS <= this.watermark || this.sealedWindows.has(start);
    for (const [id, row] of rows) {
      const chain = chainKeyOf(tenantOf(row));
      if (!this.check.inScope(chain) || this.held.has(id)) continue;
      if (sealedWindow || this.listedByFaulted.has(id)) this.unheld.set(id, { chain, windowStart: start });
    }
  }

  private async judgeCheckpoint(row: Row, head: CheckpointHead, rows: Map<string, Row>): Promise<void> {
    const body = checkpointBodyFromRow(row);
    const at = { object: this.name, chain: head.chain };
    if (this.expiryCovering(head.chain, head.sequence)) {
      // D8: a row a checkpoint inside an honoured range lists is expired, gone or not yet gone.
      for (const id of body.row_ids) {
        this.held.add(id);
        this.check.judge({ ...at, row: id, verdict: 'expired', sealed: true, sequence: body.sequence });
      }
      return;
    }
    if (!head.holds) {
      for (const id of body.row_ids) this.listedByFaulted.add(id);
      return;
    }
    let hashes: string[];
    let saltOf: ColumnSaltOf;
    try {
      hashes = checkpointLeafHashesFromRow(row, body);
    } catch (err) {
      this.check.fault({ ...at, code: 'leaf_hashes', sequence: body.sequence, message: `checkpoint ${body.sequence}: ${messageOf(err)} — it holds nothing` });
      for (const id of body.row_ids) this.listedByFaulted.add(id);
      return;
    }
    const seed = await this.openSeed(body);
    if (typeof seed === 'string') {
      this.check.fault({ ...at, code: 'seed', sequence: body.sequence, message: `checkpoint ${body.sequence}: its seed ${seed} — it holds nothing` });
      for (const id of body.row_ids) this.listedByFaulted.add(id);
      return;
    }
    saltOf = columnSaltsOf(seed, this.name);
    const redactions = this.redactions.get(this.key(head.chain, body.sequence)) ?? [];
    for (const [i, id] of body.row_ids.entries()) {
      this.held.add(id);
      const stored = rows.get(id) ?? (await this.rowById(id));
      if (!stored) {
        this.check.judge({ ...at, row: id, verdict: 'missing', sealed: true, sequence: body.sequence });
        continue;
      }
      const overrides: Record<string, string> = {};
      for (const amendment of redactions) {
        if (amendment.row_id !== id || !body.columns.committed.includes(amendment.column_name)) continue;
        const current = this.commitment(stored, amendment.column_name, saltOf);
        if (current === amendment.rewritten_commitment) overrides[amendment.column_name] = amendment.sealed_commitment;
        else if (current === amendment.sealed_commitment) {
          this.check.danglingRedaction({ ...at, amendment: amendment.id, row: id, column: amendment.column_name, sequence: body.sequence });
        }
      }
      let leaf: string | null;
      try {
        leaf = leafHash(leafInput(stored, body.columns, this.types, saltOf, overrides)).toString('hex');
      } catch {
        leaf = null; // a value with no canonical spelling is not the value sealed
      }
      if (leaf !== hashes[i]) {
        this.check.judge({ ...at, row: id, verdict: 'modified', sealed: true, sequence: body.sequence });
      } else if (Object.keys(overrides).length > 0) {
        this.check.judge({ ...at, row: id, verdict: 'redacted', sealed: true, sequence: body.sequence });
      } else if (body.kind === 'late') {
        this.check.judge({ ...at, row: id, verdict: 'late', sealed: true, sequence: body.sequence });
      } else {
        this.check.judge({ ...at, verdict: 'unmodified' });
      }
    }
  }

  /** A row's current commitment of `column`, under its checkpoint's salt; `null` when the value has no canonical spelling. */
  private commitment(row: Row, column: string, saltOf: ColumnSaltOf): string | null {
    const id = rowIdOf(row);
    try {
      return commitValue(saltOf(id, column), canonicalValue(row[column], this.types[column], `${id}.${column}`), `${id}.${column}`);
    } catch {
      return null;
    }
  }

  /**
   * The checkpoint's seed, opened under its own coordinate (D2), or what kept
   * it from opening. A read fault of the store is thrown, never read as one.
   */
  private async openSeed(body: CheckpointSignedBody): Promise<Buffer | string> {
    let handle;
    try {
      handle = await readAuditSealSecret(this.check.engine, body.seed_handle);
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
      handle = null;
    }
    if (!handle) return `'${body.seed_handle}' is missing`;
    try {
      return decodeCheckpointSeed(await this.check.crypto.decrypt(handle, checkpointSeedContext(body.sealed_object, body.tenant_id, body.sequence)));
    } catch {
      return `'${body.seed_handle}' does not open under this checkpoint's coordinate`;
    }
  }
}
