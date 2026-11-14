// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import type { CheckpointSignedBody } from './signed-body.js';
import {
  AUDIT_PROOF_BUNDLE_FORMAT,
  ChainCheck,
  judgingOrder,
  VerdictLedger,
  type AuditProofBundle,
  type AuditProofBundleLeaf,
  type AuditProofBundleObject,
  type AuditVerifyReport,
  type CheckpointHead,
} from './verifier.js';

/**
 * ADR-0154 D9 — the offline check of `os audit verify --bundle`: a proof
 * bundle a live run wrote (`--out`), re-judged with no boot and no database by
 * the verdict machine the live check uses. It proves that each row's leaf
 * input hashes to its checkpoint's leaf hash and the leaf hashes to the signed
 * root, that the links hold, that every signature verifies under a trusted
 * key, and that each expiry is honoured (D8) against the policy value its own
 * signature carries, at the offline check's time.
 *
 * Trust comes only from the fingerprints the caller gives (`--trusted-key`),
 * learnt out of band. A key the bundle carries is used only when its
 * fingerprint is one of them AND the key hashes to it; the bundle can name a
 * key, never vouch for one.
 *
 * What the bundle cannot prove is what no checkpoint it carries lists: the
 * rows of a sealed window the live run found unheld are carried as its
 * statement, and read `late` and unsealed here as there; and, as for any hash
 * chain, a chain's newest checkpoints left out leave no gap behind them.
 */

/** A bundle that is not a well-formed `objectstack.audit.proof-bundle.v1`: no verdict is given. */
export class AuditProofBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditProofBundleError';
  }
}

export interface AuditProofBundleVerifyOptions {
  /**
   * Fingerprints of the signing keys to trust (lowercase hex SHA-256 of the
   * raw public key, as the live check prints them), at least one.
   */
  trustedKeys: readonly string[];
  now?: () => number;
}

const FINGERPRINT = /^[0-9a-f]{64}$/;
type Row = Record<string, unknown>;

/** Judge a proof bundle offline. Throws {@link AuditProofBundleError} when it is not a well-formed bundle, or no key is trusted. */
export async function verifyAuditProofBundle(bundle: unknown, options: AuditProofBundleVerifyOptions): Promise<AuditVerifyReport> {
  if (options.trustedKeys.length === 0) {
    throw new AuditProofBundleError('at least one trusted key fingerprint is required: the bundle\'s own keys are never trusted');
  }
  for (const key of options.trustedKeys) {
    if (!FINGERPRINT.test(key)) throw new AuditProofBundleError(`'${key}' is not a signing key fingerprint (64 lowercase hex digits)`);
  }
  return new BundleCheck(bundleOf(bundle), options).run();
}

/** `value`, checked to be a proof bundle's shape: the records inside are judged, not refused. */
function bundleOf(value: unknown): AuditProofBundle {
  const refuse = (message: string): never => {
    throw new AuditProofBundleError(`not a proof bundle: ${message}`);
  };
  const isObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
  const isInstant = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  if (!isObject(value)) return refuse('a JSON object is required');
  if (value.format !== AUDIT_PROOF_BUNDLE_FORMAT) return refuse(`format is ${JSON.stringify(value.format)}, not '${AUDIT_PROOF_BUNDLE_FORMAT}'`);
  if (!isInstant(value.checked_at)) refuse('checked_at: an instant is required');
  const scope = value.scope;
  if (!isObject(scope)) return refuse('scope: an object is required');
  if (scope.orgs !== null && (!Array.isArray(scope.orgs) || scope.orgs.some((org) => typeof org !== 'string' || org === ''))) {
    refuse('scope.orgs: null or a list of organization ids is required');
  }
  for (const bound of ['from', 'to'] as const) if (scope[bound] !== null && !isInstant(scope[bound])) refuse(`scope.${bound}: null or an instant is required`);
  if (!Array.isArray(value.keys) || value.keys.some((k) => !isObject(k) || typeof k.fingerprint !== 'string' || typeof k.public_key !== 'string')) {
    refuse('keys: a list of { fingerprint, public_key } is required');
  }
  if (!Array.isArray(value.objects)) return refuse('objects: a list is required');
  for (const [i, object] of value.objects.entries()) {
    const at = `objects[${i}]`;
    if (!isObject(object) || typeof object.object !== 'string' || object.object === '') return refuse(`${at}.object: an object name is required`);
    for (const list of ['checkpoints', 'amendments'] as const) {
      if (!Array.isArray(object[list]) || (object[list] as unknown[]).some((r) => !isObject(r))) refuse(`${at}.${list}: a list of records is required`);
    }
    for (const [j, cp] of (object.checkpoints as Row[]).entries()) {
      const leaves = cp.leaves;
      if (leaves !== undefined && (!Array.isArray(leaves) || leaves.some((l) => l !== null && l !== 'unreadable' && !isObject(l)))) {
        refuse(`${at}.checkpoints[${j}].leaves: a list of leaf inputs, null or 'unreadable' is required`);
      }
    }
    if (!Array.isArray(object.unsealed) || object.unsealed.some((u) => !isObject(u) || typeof u.chain !== 'string' || typeof u.row !== 'string')) {
      refuse(`${at}.unsealed: a list of { chain, row } is required`);
    }
  }
  return value as unknown as AuditProofBundle;
}

class BundleCheck extends VerdictLedger {
  private readonly trusted: ReadonlySet<string>;

  constructor(private readonly bundle: AuditProofBundle, options: AuditProofBundleVerifyOptions) {
    super(
      {
        ...(bundle.scope.orgs ? { orgs: bundle.scope.orgs } : {}),
        ...(bundle.scope.from ? { from: new Date(bundle.scope.from) } : {}),
        ...(bundle.scope.to ? { to: new Date(bundle.scope.to) } : {}),
      },
      (options.now ?? Date.now)(),
    );
    this.trusted = new Set(options.trustedKeys);
  }

  async run(): Promise<AuditVerifyReport> {
    for (const object of this.bundle.objects) await new BundleObjectCheck(this, object).run();
    return this.report(this.bundle.objects.map((o) => o.object));
  }

  /** A key the caller trusts, whose public half the bundle carries and hashes to that fingerprint. */
  protected async publicKeyOf(keyId: string): Promise<string | null> {
    if (!this.trusted.has(keyId)) return null;
    for (const { fingerprint, public_key } of this.bundle.keys) {
      if (fingerprint !== keyId) continue;
      const raw = Buffer.from(public_key, 'base64');
      if (raw.length === 32 && raw.toString('base64') === public_key && createHash('sha256').update(raw).digest('hex') === keyId) return public_key;
    }
    return null;
  }
}

class BundleObjectCheck extends ChainCheck<BundleCheck> {
  /** The rows a checkpoint that holds nothing here lists and the live run read present: `late` and unsealed. */
  private readonly unholding = new Map<string, string>();
  private readonly leavesById = new Map<string, readonly AuditProofBundleLeaf[] | undefined>();

  constructor(check: BundleCheck, private readonly source: AuditProofBundleObject) {
    super(check, source.object);
  }

  async run(): Promise<void> {
    const taken = new Map<string, CheckpointHead>();
    const judged: Array<{ row: Row; head: CheckpointHead }> = [];
    for (const row of this.source.checkpoints) {
      const admitted = await this.admitCheckpoint(row, taken);
      if (!admitted) continue;
      this.leavesById.set(admitted.head.id, row.leaves as readonly AuditProofBundleLeaf[] | undefined);
      if (this.check.inScope(admitted.head.chain) && this.check.inRange(admitted.head.windowStart)) judged.push({ row, head: admitted.head });
    }
    await this.admitAmendments(this.source.amendments);
    this.checkLinks();
    for (const { row, head } of judged.sort((a, b) => judgingOrder(a.head, b.head))) {
      await this.judgeCheckpoint(row, head, async (body) => this.leavesOf(head, body));
    }
    const reported = new Set<string>();
    const unsealed = (chain: string, row: string) => {
      if (!this.check.inScope(chain) || this.held.has(row) || reported.has(row)) return;
      reported.add(row);
      this.check.judge({ object: this.name, chain, row, verdict: 'late', sealed: false, sequence: null });
    };
    for (const { chain, row } of this.source.unsealed) unsealed(chain, row);
    for (const [row, chain] of this.unholding) unsealed(chain, row);
  }

  private leavesOf(head: CheckpointHead, body: CheckpointSignedBody): readonly AuditProofBundleLeaf[] | string {
    const leaves = this.leavesById.get(head.id);
    if (leaves === undefined) return 'the bundle carries no leaf inputs for it (its seed did not open where the bundle was written)';
    if (leaves.length !== body.row_ids.length) {
      throw new AuditProofBundleError(`not a proof bundle: checkpoint ${head.id} carries ${leaves.length} leaf input(s) for ${body.row_ids.length} row id(s)`);
    }
    return leaves;
  }

  protected holdsNothing(head: CheckpointHead, body: CheckpointSignedBody): void {
    const leaves = this.leavesById.get(head.id);
    if (!leaves) return;
    for (const [i, id] of body.row_ids.entries()) if (leaves[i] !== null && leaves[i] !== undefined) this.unholding.set(id, head.chain);
  }
}
