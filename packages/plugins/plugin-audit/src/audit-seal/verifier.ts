// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { parseLifecycleDuration } from '@objectstack/objectql';
import type { IAuditCheckpointSigner, ICryptoProvider } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import { canonicalDatetime, leafHash, leafInput, rowIdOf, type SealedFieldTypes } from './canonical.js';
import { AUDIT_AMENDMENT_OBJECT, AUDIT_CHECKPOINT_OBJECT, AUDIT_SIGNING_KEY_OBJECT, checkpointSeedContext, columnSaltsOf, decodeCheckpointSeed } from './seed.js';
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

/** Where a seed's and a signing key's wrapped handles are stored (`readAuditSealSecret`). */
const SECRET_OBJECT = 'sys_secret';

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
 *
 * The verdict machine — signatures under the trusted keys, the links, the D7
 * and D8 acceptance rules, each listed row against its leaf hash — is shared
 * with the offline check of a proof bundle (`bundle.ts`, `--bundle`): only
 * where the records, the leaf inputs and the trusted keys come from differs.
 */

/** The six verdicts of D9, closed. */
export const AUDIT_ROW_VERDICTS = ['unmodified', 'modified', 'missing', 'late', 'redacted', 'expired'] as const;
export type AuditRowVerdict = (typeof AUDIT_ROW_VERDICTS)[number];

/** What failed in a chain: each one fails the run. */
export type AuditChainFaultKind =
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
  readonly kind: AuditChainFaultKind;
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

/** The format of the proof bundle `os audit verify --out` writes (D9). */
export const AUDIT_PROOF_BUNDLE_FORMAT = 'objectstack.audit.proof-bundle.v1';

/**
 * One row a checkpoint lists, as the live check read it: its leaf input (the
 * clear columns' canonical values, the value columns' salted commitments —
 * never a value, a salt or a seed), `null` when neither store holds the row,
 * `'unreadable'` when one of its values has no canonical spelling.
 */
export type AuditProofBundleLeaf = Readonly<Record<string, unknown>> | null | 'unreadable';

/**
 * A stored checkpoint (its signed body, `id`, `chain_key`, `signature`,
 * `leaf_hashes`), with `leaves` — one per `row_ids` entry, in that order —
 * when the live check judged its rows: in scope, in range, held, its seed open.
 */
export interface AuditProofBundleCheckpoint {
  readonly [column: string]: unknown;
  readonly leaves?: readonly AuditProofBundleLeaf[];
}

export interface AuditProofBundleObject {
  readonly object: string;
  /** Every in-scope checkpoint the object stores, whatever the window range: the links are checked whole. */
  readonly checkpoints: readonly AuditProofBundleCheckpoint[];
  /** Every in-scope amendment (signed body, `id`, `chain_key`, `signature`). */
  readonly amendments: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Rows of a sealed window the live check found that no trusted checkpoint holds: `late` and unsealed. */
  readonly unsealed: ReadonlyArray<{ readonly chain: string; readonly row: string }>;
}

/**
 * The proof bundle of D9 (`--out`): what an auditor needs to re-judge a live
 * run offline — public keys, checkpoints, amendments and per-row leaf inputs.
 * It carries no value, salt or seed, and its keys are candidates only: the
 * offline check trusts a key only through a fingerprint it is given. It does
 * carry personal data — the leaf inputs' clear columns identify people — so it
 * is an export of the ledger, handled as one (D9).
 */
export interface AuditProofBundle {
  readonly format: typeof AUDIT_PROOF_BUNDLE_FORMAT;
  /** When the live run that wrote it checked. */
  readonly checked_at: string;
  /** The live run's scope; the offline check judges the same. */
  readonly scope: AuditVerifyReport['scope'];
  /** The public halves (raw 32 bytes, base64) of the keys the live run's anchor vouched for. */
  readonly keys: ReadonlyArray<{ readonly fingerprint: string; readonly public_key: string }>;
  readonly objects: readonly AuditProofBundleObject[];
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
  /** Receives the run's proof bundle (D9 `--out`) once the check finished. Absent, none is built. */
  onProofBundle?: (bundle: AuditProofBundle) => void;
  now?: () => number;
}

type Row = Record<string, unknown>;

/** One object's part of a proof bundle, while the live check copies it. */
interface BundleDraft {
  readonly object: string;
  readonly checkpoints: Row[];
  readonly amendments: Row[];
  readonly unsealed: Array<{ chain: string; row: string }>;
}

const PAGE_SIZE = 500;
const iso = (ms: number): string => new Date(ms).toISOString();
const windowOf = (ms: number): number => Math.floor(ms / AUDIT_SEAL_WINDOW_MS) * AUDIT_SEAL_WINDOW_MS;
const tenantOf = (row: Row): string | null => (typeof row.tenant_id === 'string' && row.tenant_id !== '' ? row.tenant_id : null);
const zero = (): AuditVerdictCounts => ({ unmodified: 0, modified: 0, missing: 0, late: 0, redacted: 0, expired: 0, unsealed: 0 });
const messageOf = (err: unknown): string => String((err as Error)?.message ?? err);

/** @internal A checkpoint as the link pass keeps it: its signed coordinates, not its row lists. */
export interface CheckpointHead {
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

/**
 * @internal What a check gathers — chain faults, row verdicts, counts per
 * chain — and the trust it checks signatures under. The live check vouches
 * for a key through the deployment's anchor; the offline check through the
 * fingerprints it is given.
 */
export abstract class VerdictLedger {
  protected readonly now: number;
  private readonly orgs: ReadonlySet<string> | null;
  private readonly rangeLo: number;
  private readonly rangeHi: number;
  /** The D6 trust rule this check signs under ({@link SigningKeyTrust}). */
  private readonly trust = new SigningKeyTrust((keyId) => this.publicKeyOf(keyId));
  private readonly faults: AuditChainFault[] = [];
  private readonly findings: AuditRowFinding[] = [];
  private readonly dangling: AuditDanglingRedaction[] = [];
  private readonly chains = new Map<string, { object: string; chain: string; checkpoints: number; counts: AuditVerdictCounts }>();

  constructor(private readonly scope: { readonly orgs?: readonly string[]; readonly from?: Date; readonly to?: Date }, now: number) {
    this.now = now;
    this.orgs = scope.orgs ? new Set(scope.orgs) : null;
    // The windows `[from, to)` overlaps, as whole windows.
    this.rangeLo = scope.from ? windowOf(scope.from.getTime()) : Number.NEGATIVE_INFINITY;
    this.rangeHi = scope.to ? windowOf(scope.to.getTime() - 1) + AUDIT_SEAL_WINDOW_MS : Number.POSITIVE_INFINITY;
  }

  /** The public half (raw 32 bytes, base64) of signing key `keyId` when this check trusts it, else `null`. */
  protected abstract publicKeyOf(keyId: string): Promise<string | null>;

  /** Each key a record named: its public half when trusted, `null` when not. */
  protected get keys(): ReadonlyMap<string, { key: KeyObject; publicKey: string } | null> {
    return this.trust.keys;
  }

  protected report(objects: readonly string[]): AuditVerifyReport {
    const chains = [...this.chains.values()].sort((a, b) => (a.object === b.object ? cmp(a.chain, b.chain) : cmp(a.object, b.object)));
    const totals = zero();
    for (const chain of chains) for (const k of Object.keys(totals) as Array<keyof AuditVerdictCounts>) totals[k] += chain.counts[k];
    const trusted = [...this.keys].filter(([, key]) => key !== null).map(([id]) => id).sort();
    const untrusted = [...this.keys].filter(([, key]) => key === null).map(([id]) => id).sort();
    return {
      ok: this.faults.length === 0 && totals.modified === 0 && totals.missing === 0 && totals.unsealed === 0,
      sealed: objects.length > 0,
      checked_at: iso(this.now),
      scope: {
        orgs: this.scope.orgs ? [...this.scope.orgs] : null,
        from: this.scope.from ? this.scope.from.toISOString() : null,
        to: this.scope.to ? this.scope.to.toISOString() : null,
      },
      objects: [...objects],
      keys: { trusted, untrusted },
      totals,
      chains,
      rows: this.findings,
      faults: this.faults,
      dangling: this.dangling,
    };
  }

  get checkTime(): number {
    return this.now;
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

  /** Whether `signature` over `bytes` verifies under signing key `keyId`, as this check trusts it. */
  signature(keyId: string, bytes: Uint8Array, signature: unknown): Promise<SignatureVerdict> {
    return this.trust.signature(keyId, bytes, signature);
  }
}

/**
 * @internal ADR-0154 D6 — the one rule a signed body is admitted by, for every
 * reader of one: the live and offline checks, and the redaction amendment
 * writer before it proves a row against a checkpoint or names an amendment
 * already written. A signature is `ok` only under a key the trust anchor
 * vouches for (`publicKeyOf`), and only when it verifies over the body's bytes.
 * Each key is asked about once.
 */
export class SigningKeyTrust {
  /** Each key a record named: its public half when trusted, `null` when not. */
  readonly keys = new Map<string, { key: KeyObject; publicKey: string } | null>();

  constructor(private readonly publicKeyOf: (keyId: string) => Promise<string | null>) {}

  /** Whether `signature` over `bytes` verifies under signing key `keyId`, as the anchor trusts it. */
  async signature(keyId: string, bytes: Uint8Array, signature: unknown): Promise<SignatureVerdict> {
    const trusted = await this.trustedKey(keyId);
    if (!trusted) return 'untrusted_key';
    if (typeof signature !== 'string' || signature === '') return 'signature';
    try {
      return verify(null, bytes, trusted.key, Buffer.from(signature, 'base64')) ? 'ok' : 'signature';
    } catch {
      return 'signature';
    }
  }

  private async trustedKey(keyId: string): Promise<{ key: KeyObject; publicKey: string } | null> {
    if (this.keys.has(keyId)) return this.keys.get(keyId)!;
    const publicKey = await this.publicKeyOf(keyId);
    let trusted: { key: KeyObject; publicKey: string } | null = null;
    if (publicKey !== null) {
      try {
        const x = Buffer.from(publicKey, 'base64').toString('base64url');
        trusted = { key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }), publicKey };
      } catch {
        trusted = null;
      }
    }
    this.keys.set(keyId, trusted);
    return trusted;
  }
}

/**
 * @internal The live trust anchor (D6): a host's `audit.checkpointSigner` when
 * one is given, else the local key, trusted only through its wrapped private
 * half ({@link trustedSigningKey}). The two objects a key is trusted through
 * are its row and the `sys_secret` row of its wrapped private half: either
 * table absent is no key, and any other read fault is thrown rather than read
 * as tampering.
 */
export function anchoredPublicKeyOf(
  engine: SealStorageReader,
  crypto: ICryptoProvider,
  trust?: Pick<IAuditCheckpointSigner, 'trustedPublicKey'>,
): (keyId: string) => Promise<string | null> {
  return async (keyId) => {
    try {
      return trust ? await trust.trustedPublicKey(keyId) : await trustedSigningKey(engine, crypto, keyId);
    } catch (err) {
      if (!isMissingTableError(err, AUDIT_SIGNING_KEY_OBJECT) && !isMissingTableError(err, SECRET_OBJECT)) throw err;
      return null;
    }
  };
}

/** The live check: the ledger read from the hot store and the archive, keys vouched for by the anchor. */
class LedgerCheck extends VerdictLedger {
  constructor(private readonly options: AuditVerifyOptions) {
    super(options, (options.now ?? Date.now)());
  }

  async run(): Promise<AuditVerifyReport> {
    const objects = this.options.engine.registry.getAllObjects();
    const amendmentsRegistered = objects.some((o) => o.name === AUDIT_AMENDMENT_OBJECT);
    const sealed: string[] = [];
    for (const object of objects) {
      const declares = Boolean((object.lifecycle as { seal?: unknown } | undefined)?.seal);
      if (declares || (await this.hasCheckpoints(object.name))) sealed.push(object.name);
    }
    const bundled: AuditProofBundleObject[] = [];
    for (const name of sealed) {
      const object = objects.find((o) => o.name === name)!;
      const bundle: BundleDraft | null = this.options.onProofBundle ? { object: name, checkpoints: [], amendments: [], unsealed: [] } : null;
      await new ObjectCheck(this, object, amendmentsRegistered, bundle).run();
      if (bundle) bundled.push(bundle as AuditProofBundleObject);
    }
    const report = this.report(sealed);
    this.options.onProofBundle?.({
      format: AUDIT_PROOF_BUNDLE_FORMAT,
      checked_at: report.checked_at,
      scope: report.scope,
      keys: [...this.keys]
        .filter((entry): entry is [string, { key: KeyObject; publicKey: string }] => entry[1] !== null)
        .map(([fingerprint, { publicKey }]) => ({ fingerprint, public_key: publicKey }))
        .sort((a, b) => cmp(a.fingerprint, b.fingerprint)),
      objects: bundled,
    });
    return report;
  }

  // ── what only the live check reads ────────────────────────────────────────

  get engine(): AuditVerifierEngine {
    return this.options.engine;
  }

  get crypto(): ICryptoProvider {
    return this.options.crypto;
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

  protected publicKeyOf(keyId: string): Promise<string | null> {
    return anchoredPublicKeyOf(this.options.engine, this.options.crypto, this.options.trust)(keyId);
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

/** @internal The order checkpoints are judged in: by window, window checkpoints before late ones, each chain in sequence order. */
export const judgingOrder = (a: CheckpointHead, b: CheckpointHead): number =>
  windowOf(a.windowStart) - windowOf(b.windowStart) || kindOrder(a.kind) - kindOrder(b.kind) || cmp(a.chain, b.chain) || a.sequence - b.sequence;

/** @internal Every row of `object` a driver holds that `where` matches, in id order, page by page. */
export async function readAll(driver: SealStorageDriver, object: string, where: Row): Promise<Row[]> {
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

/**
 * @internal One sealed object's chains, judged from its stored records: the
 * signatures, the links with the D8 acceptance rule, and each listed row
 * against its leaf hash with the D7 rule. Where the records and the leaf
 * inputs come from is the subclass's.
 */
export abstract class ChainCheck<C extends VerdictLedger = VerdictLedger> {
  protected readonly heads = new Map<string, CheckpointHead>();
  /** Honoured expiries by chain, in sequence order (D8). */
  private readonly honoured = new Map<string, ExpiryAmendmentBody[]>();
  /** Trusted redactions by chain, checkpoint sequence and row (D7). */
  private readonly redactions = new Map<string, Array<RedactionAmendmentBody & { id: string }>>();
  /** Rows a checkpoint holds. */
  protected readonly held = new Set<string>();

  constructor(protected readonly check: C, protected readonly name: string) {}

  private key(chain: string, sequence: number): string {
    return `${chain}\u0000${sequence}`;
  }

  /** The rows `body` lists, now that it holds nothing: the subclass reads the present ones as `late` and unsealed. */
  protected abstract holdsNothing(head: CheckpointHead, body: CheckpointSignedBody): void;

  // ── chains: signatures and links ──────────────────────────────────────────

  /**
   * Admit one stored checkpoint: its faults, and its head and body when it is
   * a signed body. `signed` is whether its signature verified, before a twin
   * at its sequence took its hold away. `taken` spans one object's rows.
   */
  protected async admitCheckpoint(
    row: Row,
    taken: Map<string, CheckpointHead>,
  ): Promise<{ head: CheckpointHead; body: CheckpointSignedBody; signed: boolean } | null> {
    let body: CheckpointSignedBody;
    try {
      body = checkpointBodyFromRow(row);
    } catch (err) {
      this.check.fault({ object: this.name, chain: String(row.chain_key ?? '?'), kind: 'malformed', message: `checkpoint ${String(row.id)}: ${messageOf(err)}` });
      return null;
    }
    const chain = chainKeyOf(body.tenant_id);
    if (this.check.inScope(chain)) this.check.chain(this.name, chain).checkpoints += 1;
    if (row.chain_key !== chain) {
      this.check.fault({
        object: this.name, chain, kind: 'chain_key', sequence: body.sequence,
        message: `checkpoint ${body.sequence}: stored under chain '${String(row.chain_key)}', but its signed organization is chain '${chain}'`,
      });
    }
    const signed = await this.check.signature(body.signing_key_id, signedBodyBytes(body), row.signature);
    if (signed !== 'ok') {
      this.check.fault({
        object: this.name, chain, kind: signed, sequence: body.sequence,
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
      this.check.fault({ object: this.name, chain, kind: 'duplicate', sequence: body.sequence, message: `checkpoint ${body.sequence}: two checkpoints take this sequence — neither holds anything` });
    } else {
      taken.set(this.key(chain, body.sequence), head);
    }
    this.heads.set(head.id, head);
    return { head, body, signed: signed === 'ok' };
  }

  /** Admit the object's stored amendments: the trusted redactions kept, the expiries judged (D8). */
  protected async admitAmendments(rows: readonly Row[]): Promise<void> {
    const expiries = new Map<string, ExpiryAmendmentBody[]>();
    for (const row of rows) {
      let body;
      try {
        body = amendmentBodyFromRow(row);
      } catch (err) {
        this.check.fault({ object: this.name, chain: String(row.chain_key ?? '?'), kind: 'malformed', amendment: String(row.id), message: `amendment ${String(row.id)}: ${messageOf(err)}` });
        continue;
      }
      const chain = chainKeyOf(body.tenant_id);
      const signed = await this.check.signature(body.signing_key_id, signedBodyBytes(body), row.signature);
      if (signed !== 'ok') {
        // An amendment nothing vouches for is ignored: the row it would explain reads as what it is.
        this.check.fault({
          object: this.name, chain, kind: signed, amendment: String(row.id),
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
          object: this.name, chain, kind: 'expiry',
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

  protected checkLinks(): void {
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
          object: this.name, chain, kind: 'gap', sequence: s,
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
            object: this.name, chain, kind: 'link', sequence: head.sequence,
            message: `checkpoint ${head.sequence}: its previous_digest is not the digest of ${bridge ? `the expiry ending at ${bridge.last_sequence}` : `checkpoint ${head.sequence - 1}`}`,
          });
        }
      }
    }
  }

  // ── rows ──────────────────────────────────────────────────────────────────

  /**
   * Judge the rows checkpoint `row` lists. `leavesOf` gives each listed row's
   * leaf input, in `row_ids` order, or why there are none (the checkpoint
   * then holds nothing).
   */
  protected async judgeCheckpoint(
    row: Row,
    head: CheckpointHead,
    leavesOf: (body: CheckpointSignedBody) => Promise<readonly AuditProofBundleLeaf[] | string>,
  ): Promise<void> {
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
      this.holdsNothing(head, body);
      return;
    }
    let hashes: string[];
    try {
      hashes = checkpointLeafHashesFromRow(row, body);
    } catch (err) {
      this.check.fault({ ...at, kind: 'leaf_hashes', sequence: body.sequence, message: `checkpoint ${body.sequence}: ${messageOf(err)} — it holds nothing` });
      this.holdsNothing(head, body);
      return;
    }
    const leaves = await leavesOf(body);
    if (typeof leaves === 'string') {
      this.check.fault({ ...at, kind: 'seed', sequence: body.sequence, message: `checkpoint ${body.sequence}: ${leaves} — it holds nothing` });
      this.holdsNothing(head, body);
      return;
    }
    const redactions = this.redactions.get(this.key(head.chain, body.sequence)) ?? [];
    for (const [i, id] of body.row_ids.entries()) {
      this.held.add(id);
      const leaf = leaves[i];
      if (leaf === null) {
        this.check.judge({ ...at, row: id, verdict: 'missing', sealed: true, sequence: body.sequence });
        continue;
      }
      // A row's current commitment of a value column is its leaf's entry for it.
      const overrides: Record<string, string> = {};
      for (const amendment of leaf === 'unreadable' ? [] : redactions) {
        if (amendment.row_id !== id || !body.columns.committed.includes(amendment.column_name)) continue;
        const current = (leaf as Row)[amendment.column_name];
        if (current === amendment.rewritten_commitment) overrides[amendment.column_name] = amendment.sealed_commitment;
        else if (current === amendment.sealed_commitment) {
          this.check.danglingRedaction({ ...at, amendment: amendment.id, row: id, column: amendment.column_name, sequence: body.sequence });
        }
      }
      let hash: string | null = null;
      try {
        if (leaf !== 'unreadable') hash = leafHash({ ...leaf, ...overrides }).toString('hex');
      } catch {
        hash = null; // a value with no canonical spelling is not the value sealed
      }
      if (hash !== hashes[i]) {
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
}

/** The columns of a stored checkpoint and amendment a proof bundle copies of a row that is not a signed body. */
const CHECKPOINT_COLUMNS = [
  'id', 'chain_key', 'signature', 'leaf_hashes', 'sealed_object', 'tenant_id', 'sequence', 'kind', 'window_start', 'window_end',
  'sealed_through', 'leaf_count', 'row_ids', 'root', 'previous_digest', 'columns', 'canon_version', 'seed_handle', 'fencing_token',
  'sealed_at', 'signing_key_id',
];
const AMENDMENT_COLUMNS = [
  'id', 'chain_key', 'signature', 'sealed_object', 'tenant_id', 'amended_at', 'signing_key_id', 'kind', 'checkpoint_sequence',
  'row_id', 'column_name', 'sealed_commitment', 'rewritten_commitment', 'rewritten_by', 'first_sequence', 'last_sequence',
  'covered_from', 'covered_to', 'last_removed_digest', 'policy', 'policy_value',
];

/** `row`'s named columns, as JSON carries them. */
function copyOf(row: Row, columns: readonly string[]): Row {
  const copy: Row = {};
  for (const column of columns) {
    const value = row[column];
    if (value === undefined) continue;
    copy[column] = value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? value.toString() : value;
  }
  return copy;
}

/** A JSON column as a bundle carries it: parsed when it parses, as stored when it does not. */
function jsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** One sealed object's chains and rows, read live. */
class ObjectCheck extends ChainCheck<LedgerCheck> {
  private readonly types: SealedFieldTypes;
  private readonly hot: SealStorageDriver;
  private readonly archive: SealStorageDriver | undefined;
  /** The object's highest trusted `sealed_through`, and the windows a trusted `window` checkpoint names. */
  private watermark = Number.NEGATIVE_INFINITY;
  private readonly sealedWindows = new Set<number>();
  /** Rows only a checkpoint holding nothing lists, and rows of a sealed window nothing holds. */
  private readonly listedByFaulted = new Set<string>();
  private readonly unheld = new Map<string, { chain: string; windowStart: number }>();
  /** The bundle entry of each checkpoint copied, by id: its `leaves` are added when its rows are read. */
  private readonly bundled = new Map<string, Row>();

  constructor(
    check: LedgerCheck,
    object: { name: string; fields?: unknown; lifecycle?: unknown },
    private readonly amendmentsRegistered: boolean,
    /** Where this object's part of the proof bundle is copied; `null` when none is built. */
    private readonly bundle: BundleDraft | null,
  ) {
    super(check, object.name);
    this.types = (object.fields ?? {}) as SealedFieldTypes;
    const { engine } = check;
    const hot = engine.getDriverForObject(object.name);
    if (!hot) throw new Error(`no driver resolves for '${object.name}'`);
    this.hot = hot;
    const to = (object.lifecycle as { archive?: { to?: unknown } } | undefined)?.archive?.to;
    const archive = typeof to === 'string' && to !== '' ? check.archiveOf(to, object.name) : null;
    this.archive = archive && archive !== hot ? archive : undefined;
  }

  async run(): Promise<void> {
    await this.readCheckpoints();
    await this.readAmendments();
    this.checkLinks();
    await this.judgeRows();
  }

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
      const admitted = await this.admitCheckpoint(row, taken);
      if (admitted?.signed) {
        this.watermark = Math.max(this.watermark, Date.parse(admitted.body.sealed_through));
        if (admitted.body.kind === 'window') this.sealedWindows.add(admitted.head.windowStart);
      }
      if (this.bundle && this.check.inScope(admitted ? admitted.head.chain : String(row.chain_key ?? '?'))) {
        const entry: Row = admitted
          ? { ...admitted.body, id: admitted.head.id, chain_key: row.chain_key ?? null, signature: row.signature ?? null, leaf_hashes: jsonColumn(row.leaf_hashes) }
          : copyOf(row, CHECKPOINT_COLUMNS);
        this.bundle.checkpoints.push(entry);
        if (admitted) this.bundled.set(admitted.head.id, entry);
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
    if (this.bundle) {
      for (const row of rows) {
        let body;
        try {
          body = amendmentBodyFromRow(row);
        } catch {
          body = null;
        }
        if (!this.check.inScope(body ? chainKeyOf(body.tenant_id) : String(row.chain_key ?? '?'))) continue;
        this.bundle.amendments.push(body ? { ...body, id: String(row.id), chain_key: row.chain_key ?? null, signature: row.signature ?? null } : copyOf(row, AMENDMENT_COLUMNS));
      }
    }
    await this.admitAmendments(rows);
  }

  protected holdsNothing(_head: CheckpointHead, body: CheckpointSignedBody): void {
    for (const id of body.row_ids) this.listedByFaulted.add(id);
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
      this.bundle?.unsealed.push({ chain, row: id });
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
    const ordered = checkpoints
      .map((row) => ({ row, head: this.heads.get(String(row.id)) }))
      .filter((c): c is { row: Row; head: CheckpointHead } => c.head !== undefined && this.check.inScope(c.head.chain))
      .sort((a, b) => judgingOrder(a.head, b.head));
    for (const { row, head } of ordered) await this.judgeCheckpoint(row, head, (body) => this.readLeaves(body, head, rows));
    const sealedWindow = start + AUDIT_SEAL_WINDOW_MS <= this.watermark || this.sealedWindows.has(start);
    for (const [id, row] of rows) {
      const chain = chainKeyOf(tenantOf(row));
      if (!this.check.inScope(chain) || this.held.has(id)) continue;
      if (sealedWindow || this.listedByFaulted.has(id)) this.unheld.set(id, { chain, windowStart: start });
    }
  }

  /** The leaf input of each row `body` lists, as the stores hold it now, under the checkpoint's own seed. */
  private async readLeaves(body: CheckpointSignedBody, head: CheckpointHead, rows: Map<string, Row>): Promise<AuditProofBundleLeaf[] | string> {
    const seed = await this.openSeed(body);
    if (typeof seed === 'string') return `its seed ${seed}`;
    const saltOf = columnSaltsOf(seed, this.name);
    const leaves: AuditProofBundleLeaf[] = [];
    for (const id of body.row_ids) {
      const stored = rows.get(id) ?? (await this.rowById(id));
      let leaf: AuditProofBundleLeaf = null;
      if (stored) {
        try {
          leaf = leafInput(stored, body.columns, this.types, saltOf);
        } catch {
          leaf = 'unreadable';
        }
      }
      leaves.push(leaf);
    }
    const entry = this.bundled.get(head.id);
    if (entry) entry.leaves = leaves;
    return leaves;
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
      if (!isMissingTableError(err, SECRET_OBJECT)) throw err;
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
