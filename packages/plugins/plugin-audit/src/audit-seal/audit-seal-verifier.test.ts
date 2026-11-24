// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_PROOF_BUNDLE_FORMAT,
  AUDIT_ROW_VERDICTS,
  AuditProofBundleError,
  amendmentRow,
  canonicalJson,
  canonicalValue,
  checkpointBodyFromRow,
  checkpointDigest,
  checkpointRow,
  checkpointSeedContext,
  columnSaltsOf,
  commitValue,
  decodeCheckpointSeed,
  signedBodyBytes,
  verifyAuditLedger,
  verifyAuditProofBundle,
  type AmendmentSignedBody,
  type AuditProofBundle,
  type AuditVerifyReport,
  type CheckpointSignedBody,
  type ExpiryAmendmentBody,
  type RedactionAmendmentBody,
} from './index.js';
import { bindingCrypto, memoryEngine, recordingLogger } from './seal-store.testkit.js';
import { AuditSealer } from './sealer.js';
import type { IAuditCheckpointSigner } from '@objectstack/spec/contracts';
import { signingKeyContext } from './seed.js';
import { LocalCheckpointSigner, readAuditSealSecret, trustedSigningKey, writeAuditSealSecret } from './signer.js';

/**
 * ADR-0154 D9 — the live check over an in-memory engine double: per-row
 * verdicts against each checkpoint's leaf hashes, the trusted keys only, the
 * links of each chain, the scope flags, and the D7 / D8 acceptance rules over
 * hand-built amendments (their writers come with P3 and P4).
 *
 * Every live run here also writes its proof bundle (`--out`), and
 * `verifyNow` holds that the bundle, re-judged offline (`--bundle`) under the
 * deployment's fingerprint, gives the same report: each scenario below is
 * also a pin of the offline check.
 */

const H = 60 * 60 * 1000;
const DAY0 = Date.UTC(2026, 10, 10);
const at = (h: number, m: number) => new Date(DAY0 + h * H + m * 60_000).toISOString();

const LEDGER = {
  name: 'ledger_probe',
  fields: { id: { type: 'text' }, created_at: { type: 'datetime' }, action: { type: 'text' }, tenant_id: { type: 'lookup' }, payload: { type: 'textarea' } },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'archive' }, seal: { valueFields: ['payload'] } },
};
const AMENDMENTS = { name: 'sys_audit_amendment', fields: {} };

const row = (id: string, created: string, tenant: string | null = 'org_a') => ({ id, created_at: created, action: 'update', tenant_id: tenant, payload: `{"v":"${id}"}` });

/**
 * A ledger sealed at 12:30: window 08:00 holds r1, r2 (org_a) and r3 (the
 * deployment), window 10:00 holds r4 (org_a), window 11:00 holds r5 (org_b).
 */
async function sealedLedger(options: { objects?: unknown[] } = {}) {
  const store = memoryEngine((options.objects ?? [LEDGER, AMENDMENTS]) as never);
  const crypto = bindingCrypto();
  const signer = new LocalCheckpointSigner({ engine: store.engine, crypto });
  const clock = { now: DAY0 + 12 * H + 30 * 60_000 };
  const sealer = new AuditSealer({ engine: store.engine, crypto, signer: () => signer, logger: recordingLogger(), now: () => clock.now });
  const ledger = store.hot.table('ledger_probe');
  ledger.push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(8, 30), null), row('r4', at(10, 5)), row('r5', at(11, 10), 'org_b'));
  await sealer.runPass();
  const checkpoints = () => store.hot.table('sys_audit_checkpoint');
  const checkpoint = (chain: string, sequence: number) => checkpoints().find((r) => r.chain_key === chain && r.sequence === sequence)!;
  /** The live check, and its proof bundle re-judged offline: the same report, fault texts aside. */
  const verifyNow = async (extra: { orgs?: string[]; from?: Date; to?: Date } = {}) => {
    let bundle: AuditProofBundle | undefined;
    const report = await verifyAuditLedger({ engine: store.engine, crypto, now: () => clock.now, ...extra, onProofBundle: (b) => { bundle = b; } });
    const offline = await verifyAuditProofBundle(JSON.parse(JSON.stringify(bundle)), { trustedKeys: [keyId], now: () => clock.now });
    expect(comparable(offline)).toEqual(comparable(report));
    return report;
  };
  /** The live check's proof bundle, as a file carries it. */
  const bundleNow = async (): Promise<AuditProofBundle> => {
    let bundle: AuditProofBundle | undefined;
    await verifyAuditLedger({ engine: store.engine, crypto, now: () => clock.now, onProofBundle: (b) => { bundle = b; } });
    return JSON.parse(JSON.stringify(bundle));
  };
  const keyId = (await signer.activeKeyId())!;
  /** A trusted amendment row, signed by the deployment's key. */
  const amend = async (body: Omit<RedactionAmendmentBody, 'signing_key_id'> | Omit<ExpiryAmendmentBody, 'signing_key_id'>, id = `am_${store.hot.table('sys_audit_amendment').length}`) => {
    const full = { ...body, signing_key_id: keyId } as AmendmentSignedBody;
    const { signature } = await signer.sign(signedBodyBytes(full));
    store.hot.table('sys_audit_amendment').push(amendmentRow(full, { id, signature }));
    return id;
  };
  /** The commitment of `value` for `column` of `rowId`, under the salt of the checkpoint holding it. */
  const commitmentOf = async (cp: Record<string, unknown>, rowId: string, value: string, column = 'payload') => {
    const body = checkpointBodyFromRow(cp);
    const handle = await readAuditSealSecret(store.engine, body.seed_handle);
    const seed = decodeCheckpointSeed(await crypto.decrypt(handle!, checkpointSeedContext(body.sealed_object, body.tenant_id, body.sequence)));
    return commitValue(columnSaltsOf(seed, 'ledger_probe')(rowId, column), canonicalValue(value, { type: 'text' }));
  };
  return { ...store, crypto, signer, sealer, clock, ledger, checkpoints, checkpoint, verifyNow, bundleNow, keyId, amend, commitmentOf };
}

/** A report as the live and the offline check must agree on it: the fault texts and the check's time aside. */
const comparable = (report: AuditVerifyReport) => ({
  ...report,
  checked_at: undefined,
  faults: report.faults.map(({ message: _message, ...fault }) => fault),
});

/** Each row that is not unmodified, as `id: verdict` (`late!` for an unsealed late row). */
const verdicts = (report: AuditVerifyReport) =>
  Object.fromEntries(report.rows.map((r) => [r.row, r.verdict === 'late' && !r.sealed ? 'late!' : r.verdict]));
const faultKinds = (report: AuditVerifyReport) => report.faults.map((f) => `${f.chain}#${f.sequence ?? '-'}:${f.kind}`).sort();

/** A signing key nobody vouches for: its row is planted, its private half is the forger's own. */
function plantKey(s: Awaited<ReturnType<typeof sealedLedger>>) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url');
  const fingerprint = createHash('sha256').update(raw).digest('hex');
  s.hot.table('sys_audit_signing_key').push({ id: 'planted', fingerprint, public_key: raw.toString('base64'), private_handle: 'no-such-secret', status: 'active', created_at: at(0, 0), retired_at: null });
  return { fingerprint, sign: (bytes: Uint8Array) => sign(null, bytes, privateKey).toString('base64') };
}

describe('the verdicts are closed (D9)', () => {
  it('names exactly the six verdicts', () => {
    expect([...AUDIT_ROW_VERDICTS]).toEqual(['unmodified', 'modified', 'missing', 'late', 'redacted', 'expired']);
  });
});

describe('an untouched ledger verifies (D9 exit 0)', () => {
  it('reads every row unmodified, under the one key the deployment vouches for, with counts per chain', async () => {
    const s = await sealedLedger();
    const report = await s.verifyNow();
    expect(report.ok).toBe(true);
    expect(report.sealed).toBe(true);
    expect(report.faults).toEqual([]);
    expect(report.rows).toEqual([]);
    expect(report.keys).toEqual({ trusted: [s.keyId], untrusted: [] });
    expect(report.totals.unmodified).toBe(5);
    expect(report.chains.map((c) => [c.chain, c.checkpoints, c.counts.unmodified])).toEqual([
      ['deployment', 1, 1],
      ['org:org_a', 2, 3],
      ['org:org_b', 1, 1],
    ]);
  });

  it('reports nothing sealed when no object declares seal and no checkpoint is stored', async () => {
    const store = memoryEngine([{ name: 'plain', fields: {} }] as never);
    const report = await verifyAuditLedger({ engine: store.engine, crypto: bindingCrypto() });
    expect(report).toMatchObject({ ok: true, sealed: false, objects: [], rows: [], faults: [] });
  });

  it('reads a row the archive now holds as unmodified: the move is not a change (D8)', async () => {
    const s = await sealedLedger();
    const at1 = s.ledger.findIndex((r) => r.id === 'r1');
    s.archive.table('ledger_probe').push(...s.ledger.splice(at1, 1));
    const report = await s.verifyNow();
    expect(report.ok).toBe(true);
    expect(report.totals.unmodified).toBe(5);
  });
});

describe('each row is judged against its own leaf hash (option A)', () => {
  it('reads an edited row modified and its untouched sibling in the same checkpoint unmodified', async () => {
    const s = await sealedLedger();
    s.ledger.find((r) => r.id === 'r1')!.payload = '{"v":"forged"}';
    const report = await s.verifyNow();
    expect(verdicts(report)).toEqual({ r1: 'modified' });
    expect(report.rows[0]).toMatchObject({ object: 'ledger_probe', chain: 'org:org_a', sequence: 0, sealed: true });
    expect(report.chains.find((c) => c.chain === 'org:org_a')!.counts).toMatchObject({ unmodified: 2, modified: 1 });
    expect(report.ok).toBe(false);
  });

  it('reads a deleted row missing and its sibling unmodified', async () => {
    const s = await sealedLedger();
    s.ledger.splice(s.ledger.findIndex((r) => r.id === 'r2'), 1);
    const report = await s.verifyNow();
    expect(verdicts(report)).toEqual({ r2: 'missing' });
    expect(report.totals).toMatchObject({ unmodified: 4, missing: 1 });
    expect(report.ok).toBe(false);
  });

  it('reads a row whose created_at moved to another sealed window modified, once', async () => {
    const s = await sealedLedger();
    s.ledger.find((r) => r.id === 'r1')!.created_at = at(9, 15);
    const report = await s.verifyNow();
    expect(verdicts(report)).toEqual({ r1: 'modified' });
  });
});

describe('late rows (D3, D9)', () => {
  it('reads a row a late checkpoint holds as late and sealed: the run passes', async () => {
    const s = await sealedLedger();
    s.ledger.push(row('tardy', at(8, 50)));
    s.clock.now += H;
    await s.sealer.runPass();
    const report = await s.verifyNow();
    expect(verdicts(report)).toEqual({ tardy: 'late' });
    expect(report.rows[0].sealed).toBe(true);
    expect(report.ok).toBe(true);
  });

  it('reads a row of a sealed window no checkpoint lists as late and unsealed: the run fails', async () => {
    const s = await sealedLedger();
    s.ledger.push(row('backdated', at(9, 30)), row('in_sealed', at(10, 40), 'org_c'));
    const report = await s.verifyNow();
    expect(verdicts(report)).toEqual({ backdated: 'late!', in_sealed: 'late!' });
    expect(report.rows.every((r) => r.sequence === null)).toBe(true);
    expect(report.totals).toMatchObject({ late: 2, unsealed: 2 });
    expect(report.ok).toBe(false);
  });

  it('gives no verdict to a row after the last sealed window: it is not yet due', async () => {
    const s = await sealedLedger();
    s.ledger.push(row('fresh', at(12, 20)));
    const report = await s.verifyNow();
    expect(report.ok).toBe(true);
    expect(report.rows).toEqual([]);
  });
});

describe('trust: only keys the anchor vouches for (D6)', () => {
  it('refuses a checkpoint re-signed under a planted key: a fault, the key untrusted, its rows late and unsealed', async () => {
    const s = await sealedLedger();
    const planted = plantKey(s);
    const cp = s.checkpoint('org:org_b', 0);
    s.ledger.find((r) => r.id === 'r5')!.payload = '{"v":"forged"}';
    const forged = { ...checkpointBodyFromRow(cp), signing_key_id: planted.fingerprint } as CheckpointSignedBody;
    Object.assign(cp, { signing_key_id: planted.fingerprint, signature: planted.sign(signedBodyBytes(forged)) });
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_b#0:untrusted_key']);
    expect(report.keys.untrusted).toEqual([planted.fingerprint]);
    expect(report.keys.trusted).toEqual([s.keyId]);
    expect(verdicts(report)).toEqual({ r5: 'late!' });
    expect(report.ok).toBe(false);
  });

  it('refuses a checkpoint whose signed fields were changed: the signature fails, and the next link with it', async () => {
    const s = await sealedLedger();
    s.checkpoint('org:org_a', 0).sealed_at = at(12, 0);
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_a#0:signature', 'org:org_a#1:link']);
    expect(verdicts(report)).toEqual({ r1: 'late!', r2: 'late!' });
  });

  it('refuses two checkpoints at one sequence of one chain: neither holds anything', async () => {
    const s = await sealedLedger();
    s.checkpoints().push({ ...s.checkpoint('org:org_b', 0), id: 'twin' });
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_b#0:duplicate']);
    expect(verdicts(report)).toEqual({ r5: 'late!' });
  });

  it('faults a row id two checkpoints list, though each is signed and linked: the second listing holds nothing (S7)', async () => {
    const s = await sealedLedger();
    // A second, validly signed and linked checkpoint of org_b re-listing r5, under its own sealed seed.
    const first = checkpointBodyFromRow(s.checkpoint('org:org_b', 0));
    const handle = await readAuditSealSecret(s.engine, first.seed_handle);
    const seed = await s.crypto.decrypt(handle!, checkpointSeedContext('ledger_probe', 'org_b', 0));
    const context = checkpointSeedContext('ledger_probe', 'org_b', 1);
    const resealed = await s.crypto.encrypt(seed, context);
    await writeAuditSealSecret(s.engine, resealed, context);
    const body: CheckpointSignedBody = { ...first, sequence: 1, previous_digest: checkpointDigest(first), seed_handle: resealed.id };
    const { signature } = await s.signer.sign(signedBodyBytes(body));
    s.checkpoints().push(checkpointRow(body, { id: 'again', signature, leafHashes: JSON.parse(String(s.checkpoint('org:org_b', 0).leaf_hashes)) }));
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_b#1:listed_twice']);
    expect(report.ok).toBe(false);
    expect(report.totals).toMatchObject({ unmodified: 5 });
  });

  it('reports a checkpoint row that is not a signed body as malformed: the run fails', async () => {
    const s = await sealedLedger();
    s.checkpoint('org:org_b', 0).row_ids = '["r5","r5"]';
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_b#-:malformed']);
    expect(report.ok).toBe(false);
  });

  it('refuses a stored chain key that disagrees with the signed organization', async () => {
    const s = await sealedLedger();
    s.checkpoint('org:org_b', 0).chain_key = 'org:org_z';
    expect(faultKinds(await s.verifyNow())).toEqual(['org:org_b#0:chain_key']);
  });
});

describe('a checkpoint holds its rows only through its signed root and its seed', () => {
  it('refuses leaf hashes that do not rebuild the signed root: the checkpoint holds nothing', async () => {
    const s = await sealedLedger();
    const cp = s.checkpoint('org:org_a', 0);
    const hashes = JSON.parse(String(cp.leaf_hashes)) as string[];
    cp.leaf_hashes = canonicalJson([hashes[1], hashes[0]]);
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_a#0:leaf_hashes']);
    expect(report.faults[0].message).toMatch(/do not rebuild the signed root/);
    expect(verdicts(report)).toEqual({ r1: 'late!', r2: 'late!' });
  });

  it('refuses leaf hashes of another length than the row ids and the leaf count', async () => {
    const s = await sealedLedger();
    const cp = s.checkpoint('org:org_a', 0);
    cp.leaf_hashes = canonicalJson((JSON.parse(String(cp.leaf_hashes)) as string[]).slice(0, 1));
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_a#0:leaf_hashes']);
    expect(report.faults[0].message).toMatch(/1 hash\(es\) for 2 row id\(s\) and a leaf count of 2/);
  });

  it('refuses a checkpoint whose seed is gone', async () => {
    const s = await sealedLedger();
    const handle = checkpointBodyFromRow(s.checkpoint('org:org_b', 0)).seed_handle;
    const secrets = s.hot.table('sys_secret');
    secrets.splice(secrets.findIndex((r) => r.id === handle), 1);
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_b#0:seed']);
    expect(verdicts(report)).toEqual({ r5: 'late!' });
  });
});

describe('links: the whole chain, whatever the window range (D4)', () => {
  it('reports a removed checkpoint as a gap, and its rows as unsealed', async () => {
    const s = await sealedLedger();
    s.ledger.push(row('r6', at(11, 30)));
    s.clock.now += H;
    await s.sealer.runPass(); // org_a sequence 2: window 11:00, resumed for the chain it did not hold
    const cps = s.checkpoints();
    cps.splice(cps.indexOf(s.checkpoint('org:org_a', 1)), 1);
    const report = await s.verifyNow();
    expect(faultKinds(report)).toEqual(['org:org_a#1:gap']);
    expect(verdicts(report)).toEqual({ r4: 'late!' });
  });

  it('checks links outside --from/--to, and judges rows only inside', async () => {
    const s = await sealedLedger();
    s.checkpoint('org:org_a', 0).sealed_at = at(12, 0);
    s.ledger.find((r) => r.id === 'r5')!.payload = 'x';
    const report = await s.verifyNow({ from: new Date(at(10, 30)), to: new Date(at(11, 0)) });
    expect(faultKinds(report)).toEqual(['org:org_a#0:signature', 'org:org_a#1:link']);
    expect(report.rows).toEqual([]);
    expect(report.totals.unmodified).toBe(1); // r4: window 10:00 is the one [10:30, 11:00) overlaps
  });

  it('limits the check to the named organizations, the deployment chain left out', async () => {
    const s = await sealedLedger();
    s.ledger.find((r) => r.id === 'r3')!.payload = 'x';
    s.ledger.find((r) => r.id === 'r5')!.payload = 'x';
    s.checkpoint('deployment', 0).sealed_at = at(12, 0);
    const report = await s.verifyNow({ orgs: ['org_b'] });
    expect(report.chains.map((c) => c.chain)).toEqual(['org:org_b']);
    expect(verdicts(report)).toEqual({ r5: 'modified' });
    expect(report.faults).toEqual([]);
  });
});

describe('redaction amendments (D7)', () => {
  const redaction = async (s: Awaited<ReturnType<typeof sealedLedger>>, rowId: string, rewritten: string) => {
    const cp = s.checkpoint('org:org_a', 0);
    const sealedValue = String(s.ledger.find((r) => r.id === rowId)!.payload);
    return {
      kind: 'redaction' as const,
      sealed_object: 'ledger_probe',
      tenant_id: 'org_a',
      amended_at: at(12, 40),
      checkpoint_sequence: 0,
      row_id: rowId,
      column_name: 'payload',
      sealed_commitment: await s.commitmentOf(cp, rowId, sealedValue),
      rewritten_commitment: await s.commitmentOf(cp, rowId, rewritten),
      rewritten_by: 'migrate audit-mail-body',
    };
  };

  it('reads a rewritten row redacted when a trusted amendment rebuilds its sealed leaf', async () => {
    const s = await sealedLedger();
    await s.amend(await redaction(s, 'r1', '[masked]'));
    s.ledger.find((r) => r.id === 'r1')!.payload = '[masked]';
    const report = await s.verifyNow();
    expect(verdicts(report)).toEqual({ r1: 'redacted' });
    expect(report.ok).toBe(true);
  });

  it('reads a row whose rewrite never landed unmodified, and lists the amendment as dangling', async () => {
    const s = await sealedLedger();
    const id = await s.amend(await redaction(s, 'r1', '[masked]'));
    const report = await s.verifyNow();
    expect(report.rows).toEqual([]);
    expect(report.dangling).toEqual([{ object: 'ledger_probe', chain: 'org:org_a', amendment: id, row: 'r1', column: 'payload', sequence: 0 }]);
    expect(report.ok).toBe(true);
  });

  it('ignores an amendment signed under a planted key: the row reads modified', async () => {
    const s = await sealedLedger();
    const planted = plantKey(s);
    const body = { ...(await redaction(s, 'r1', '[masked]')), signing_key_id: planted.fingerprint } as AmendmentSignedBody;
    s.hot.table('sys_audit_amendment').push(amendmentRow(body, { id: 'forged', signature: planted.sign(signedBodyBytes(body)) }));
    s.ledger.find((r) => r.id === 'r1')!.payload = '[masked]';
    const report = await s.verifyNow();
    expect(verdicts(report)).toEqual({ r1: 'modified' });
    expect(report.faults.map((f) => [f.kind, f.amendment])).toEqual([['untrusted_key', 'forged']]);
  });

  it('ignores an amendment for a row or a column the named checkpoint does not seal as a commitment', async () => {
    const s = await sealedLedger();
    await s.amend({ ...(await redaction(s, 'r1', '[masked]')), checkpoint_sequence: 1 }); // sequence 1 lists r4, not r1
    s.ledger.find((r) => r.id === 'r1')!.payload = '[masked]';
    // `action` enters the leaf in clear: an amendment naming it explains nothing, so r2 stays unmodified, never redacted.
    const cp = s.checkpoint('org:org_a', 0);
    await s.amend({ ...(await redaction(s, 'r2', '[masked]')), column_name: 'action', rewritten_commitment: await s.commitmentOf(cp, 'r2', 'update', 'action') });
    expect(verdicts(await s.verifyNow())).toEqual({ r1: 'modified' });
  });

  it('reads no amendment while sys_audit_amendment is not registered (P3 registers it)', async () => {
    const s = await sealedLedger({ objects: [LEDGER] });
    await s.amend(await redaction(s, 'r1', '[masked]'));
    s.ledger.find((r) => r.id === 'r1')!.payload = '[masked]';
    expect(verdicts(await s.verifyNow())).toEqual({ r1: 'modified' });
  });
});

describe('expiry amendments (D8)', () => {
  /** Expire org_a's sequence 0 (window 08:00): rows first, then the checkpoint — or stop between the two. */
  const expire = async (s: Awaited<ReturnType<typeof sealedLedger>>, options: { keep?: string; first?: number; last?: number; digest?: string; removeCheckpoint?: boolean } = {}) => {
    const cp = s.checkpoint('org:org_a', 0);
    const body = checkpointBodyFromRow(cp);
    await s.amend({
      kind: 'expiry',
      sealed_object: 'ledger_probe',
      tenant_id: 'org_a',
      amended_at: new Date(s.clock.now).toISOString(),
      first_sequence: options.first ?? 0,
      last_sequence: options.last ?? 0,
      covered_from: body.window_start,
      covered_to: body.window_end,
      last_removed_digest: options.digest ?? checkpointDigest(body),
      policy: 'archive.keep',
      policy_value: options.keep ?? '7d',
    });
    for (const id of body.row_ids) s.ledger.splice(s.ledger.findIndex((r) => r.id === id), 1);
    if (options.removeCheckpoint !== false) s.checkpoints().splice(s.checkpoints().indexOf(cp), 1);
  };

  it('honours a prefix expired past the keep its own signature carries: no gap, no row reported', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    await expire(s);
    const report = await s.verifyNow();
    expect(report.faults).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('reads the rows a surviving checkpoint of an honoured range lists as expired (a sweep stopped midway)', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    await expire(s, { removeCheckpoint: false });
    s.ledger.push(row('r2', at(8, 20))); // the second of the two not yet deleted
    const report = await s.verifyNow();
    expect(verdicts(report)).toEqual({ r1: 'expired', r2: 'expired' });
    expect(report.ok).toBe(true);
  });

  it('refuses an expiry whose windows are not yet past its own keep: the range reads missing', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    await expire(s, { keep: '90d' });
    expect(faultKinds(await s.verifyNow())).toEqual(['org:org_a#-:expiry', 'org:org_a#0:gap']);
  });

  it('refuses an expiry that does not start at the chain front', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    await expire(s, { first: 1, last: 1 });
    expect(faultKinds(await s.verifyNow())).toEqual(['org:org_a#-:expiry', 'org:org_a#0:gap']);
  });

  it('refuses an expiry whose carried digest is not what the first remaining checkpoint links to', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    await expire(s, { digest: 'f'.repeat(64) });
    expect(faultKinds(await s.verifyNow())).toEqual(['org:org_a#1:link']);
  });

  it('never reads a row written back into an expired window as expired: no checkpoint holds it', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    await expire(s);
    s.ledger.push(row('r1', at(8, 10)));
    expect(verdicts(await s.verifyNow())).toEqual({ r1: 'late!' });
  });
});

describe('the archive is read or the check does not run', () => {
  it('throws when a sealed object archives to a datasource this boot did not connect', async () => {
    const s = await sealedLedger();
    const engine = { ...s.engine, datasource: () => undefined };
    await expect(verifyAuditLedger({ engine, crypto: s.crypto })).rejects.toThrow(/archives to datasource 'archive', which this boot did not connect/);
    await expect(verifyAuditLedger({ engine: s.engine, crypto: s.crypto, archive: () => undefined })).rejects.toThrow(/did not connect/);
  });

  it("reads the hot store alone when the caller established that no archive exists ('none')", async () => {
    const s = await sealedLedger();
    const engine = { ...s.engine, datasource: () => undefined };
    const report = await verifyAuditLedger({ engine, crypto: s.crypto, now: () => s.clock.now, archive: () => 'none' });
    expect(report.ok).toBe(true);
    expect(report.totals.unmodified).toBe(5);
  });
});

describe('the proof bundle: written by the live check (--out), judged offline (--bundle)', () => {
  type Bundle = { keys: Array<{ fingerprint: string; public_key: string }>; objects: Array<{ checkpoints: Array<Record<string, any>>; amendments: Array<Record<string, any>>; unsealed: unknown[] }> };
  const offline = (bundle: unknown, trustedKeys: string[], now?: number) =>
    verifyAuditProofBundle(bundle, { trustedKeys, ...(now === undefined ? {} : { now: () => now }) });
  const cpOf = (bundle: Bundle, chain: string, sequence: number) =>
    bundle.objects[0].checkpoints.find((c) => c.chain_key === chain && c.sequence === sequence)!;

  it('carries the trusted public key, every checkpoint and each judged row\'s leaf input — and no value, salt or seed', async () => {
    const s = await sealedLedger();
    const bundle = (await s.bundleNow()) as unknown as Bundle & AuditProofBundle;
    expect(bundle.format).toBe(AUDIT_PROOF_BUNDLE_FORMAT);
    expect(bundle.keys).toEqual([{ fingerprint: s.keyId, public_key: s.hot.table('sys_audit_signing_key')[0].public_key }]);
    expect(bundle.objects[0].checkpoints).toHaveLength(4);
    expect(cpOf(bundle, 'org:org_a', 0).leaves.map((l: Record<string, unknown>) => Object.keys(l).sort())).toEqual([
      ['action', 'created_at', 'id', 'payload', 'tenant_id'],
      ['action', 'created_at', 'id', 'payload', 'tenant_id'],
    ]);
    // Scan the bytes: no stored value of a value column, no seed (wrapped or open), no column salt, no private half.
    const text = JSON.stringify(bundle);
    const needles: string[] = s.ledger.map((r) => JSON.stringify(String(r.payload)).slice(1, -1));
    for (const secret of s.hot.table('sys_secret')) needles.push(String(secret.ciphertext));
    for (const cp of s.checkpoints()) {
      const body = checkpointBodyFromRow(cp);
      const handle = await readAuditSealSecret(s.engine, body.seed_handle);
      const opened = await s.crypto.decrypt(handle!, checkpointSeedContext(body.sealed_object, body.tenant_id, body.sequence));
      const seed = decodeCheckpointSeed(opened);
      needles.push(opened, seed.toString('hex'), seed.toString('base64'));
      for (const id of body.row_ids) {
        for (const column of ['payload', 'action']) {
          const salt = Buffer.from(columnSaltsOf(seed, 'ledger_probe')(id, column));
          needles.push(salt.toString('hex'), salt.toString('base64'));
        }
      }
    }
    for (const needle of needles) expect(text.includes(needle), `the bundle carries ${needle}`).toBe(false);
  });

  it('verifies offline under the right fingerprint (ok), and fails under a wrong one: the bundle\'s own key is never trusted', async () => {
    const s = await sealedLedger();
    const bundle = await s.bundleNow();
    const right = await offline(bundle, [s.keyId]);
    expect(right.ok).toBe(true);
    expect(right.totals.unmodified).toBe(5);
    const wrong = await offline(bundle, ['f'.repeat(64)]);
    expect(wrong.ok).toBe(false);
    expect(wrong.keys).toEqual({ trusted: [], untrusted: [s.keyId] });
    expect(new Set(wrong.faults.map((f) => f.kind))).toEqual(new Set(['untrusted_key']));
    // A checkpoint that holds nothing holds none of its present rows: each reads late and unsealed.
    expect(wrong.totals).toMatchObject({ unmodified: 0, late: 5, unsealed: 5 });
  });

  it('refuses a bundle with no trusted fingerprint, a fingerprint that is not one, or another format: no verdict', async () => {
    const s = await sealedLedger();
    const bundle = await s.bundleNow();
    await expect(offline(bundle, [])).rejects.toThrow(AuditProofBundleError);
    await expect(offline(bundle, ['not-a-key'])).rejects.toThrow(/is not a signing key fingerprint/);
    await expect(offline({ ...bundle, format: 'objectstack.audit.proof-bundle.v0' }, [s.keyId])).rejects.toThrow(/not a proof bundle: format/);
    await expect(offline({ ...bundle, objects: [{ object: 'ledger_probe', checkpoints: 'x' }] }, [s.keyId])).rejects.toThrow(AuditProofBundleError);
    const short = JSON.parse(JSON.stringify(bundle)) as Bundle;
    cpOf(short, 'org:org_a', 0).leaves.pop();
    await expect(offline(short, [s.keyId])).rejects.toThrow(/carries 1 leaf input\(s\) for 2 row id\(s\)/);
  });

  it('trusts a key the bundle carries only when it hashes to the fingerprint given', async () => {
    const s = await sealedLedger();
    const planted = plantKey(s);
    const bundle = (await s.bundleNow()) as unknown as Bundle;
    bundle.keys[0].public_key = s.hot.table('sys_audit_signing_key').find((k) => k.id === 'planted')!.public_key as string;
    const report = await offline(bundle, [s.keyId, planted.fingerprint]);
    expect(report.keys).toEqual({ trusted: [], untrusted: [s.keyId] });
    expect(report.ok).toBe(false);
  });

  it('reads a tampered bundle as tampered: a changed leaf modified, a dropped checkpoint a gap, dropped leaf inputs a seed fault', async () => {
    const s = await sealedLedger();
    const bundle = (await s.bundleNow()) as unknown as Bundle;
    const leaf = cpOf(bundle, 'org:org_a', 1).leaves[0];
    leaf.payload = await s.commitmentOf(s.checkpoint('org:org_a', 1), 'r4', '{"v":"forged"}');
    delete cpOf(bundle, 'org:org_b', 0).leaves;
    bundle.objects[0].checkpoints.splice(bundle.objects[0].checkpoints.indexOf(cpOf(bundle, 'org:org_a', 0)), 1);
    const report = await offline(bundle, [s.keyId]);
    expect(verdicts(report)).toEqual({ r4: 'modified' });
    expect(faultKinds(report)).toEqual(['org:org_a#0:gap', 'org:org_b#0:seed']);
    expect(report.faults.find((f) => f.kind === 'seed')!.message).toMatch(/the bundle carries no leaf inputs for it/);
    expect(report.ok).toBe(false);
  });

  it('judges an expiry offline by the policy value its own signature carries, at the offline check\'s time (D8)', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    const cp = s.checkpoint('org:org_a', 0);
    const body = checkpointBodyFromRow(cp);
    await s.amend({
      kind: 'expiry', sealed_object: 'ledger_probe', tenant_id: 'org_a', amended_at: new Date(s.clock.now).toISOString(),
      first_sequence: 0, last_sequence: 0, covered_from: body.window_start, covered_to: body.window_end,
      last_removed_digest: checkpointDigest(body), policy: 'archive.keep', policy_value: '7d',
    });
    for (const id of body.row_ids) s.ledger.splice(s.ledger.findIndex((r) => r.id === id), 1);
    s.checkpoints().splice(s.checkpoints().indexOf(cp), 1);
    const bundle = (await s.bundleNow()) as unknown as Bundle;
    expect((await offline(bundle, [s.keyId], s.clock.now)).ok).toBe(true);
    // Too early for its own keep: not honoured, so the expired range is a gap.
    expect(faultKinds(await offline(bundle, [s.keyId], DAY0 + 2 * 24 * H))).toEqual(['org:org_a#-:expiry', 'org:org_a#0:gap']);
    // A policy value changed in the bundle is no longer what was signed: the amendment is ignored.
    bundle.objects[0].amendments[0].policy_value = '1d';
    expect(faultKinds(await offline(bundle, [s.keyId], s.clock.now))).toEqual(['org:org_a#-:signature', 'org:org_a#0:gap']);
  });
});

describe('the anchor tells a store that did not answer from a key that does not open (D6)', () => {
  it('stops the run when the sys_secret row of a key\'s wrapped half cannot be read: no verdict, not an untrusted key', async () => {
    const s = await sealedLedger();
    const handle = String(s.hot.table('sys_audit_signing_key')[0].private_handle);
    const find = s.hot.find.bind(s.hot);
    s.hot.find = async (object, query) => {
      if (object === 'sys_secret' && (query.where as { id?: unknown } | undefined)?.id === handle) throw new Error('connection reset by peer');
      return find(object, query);
    };
    await expect(verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now })).rejects.toThrow(/connection reset by peer/);
  });

  it('reads a key whose wrapped half does not open as untrusted: the run finishes, and fails', async () => {
    const s = await sealedLedger();
    const handle = s.hot.table('sys_audit_signing_key')[0].private_handle;
    const secret = s.hot.table('sys_secret').find((r) => r.id === handle)!;
    const blob = Buffer.from(String(secret.ciphertext), 'base64');
    blob[blob.length - 1] ^= 0xff;
    secret.ciphertext = blob.toString('base64');
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, now: () => s.clock.now });
    expect(report.keys).toEqual({ trusted: [], untrusted: [s.keyId] });
    expect(new Set(report.faults.map((f) => f.kind))).toEqual(new Set(['untrusted_key']));
    expect(report.ok).toBe(false);
  });
});

/**
 * A host signer that signs ES256 (ECDSA P-256, SHA-256) the way a KMS-held key
 * does (Azure Key Vault's encoding, `r || s`), under the key id the amended
 * D4 gives an ES256 key: the SHA-256 of its SPKI DER. Its `trustedPublicKey`
 * answers for its own key and for every key it pins (ADR-0154 D6, amended):
 * the `{ fingerprint, public_key }` pairs of a proof bundle's `keys`.
 */
function es256HostSigner(pins: ReadonlyArray<{ fingerprint: string; public_key: string }> = []) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const keyId = createHash('sha256').update(spki).digest('hex');
  const pinned = new Map(pins.map((k) => [k.fingerprint, k.public_key]));
  const p1363 = (bytes: Uint8Array) => sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const signer: IAuditCheckpointSigner = {
    sign: async (bytes) => ({ keyId, signature: p1363(bytes).toString('base64') }),
    trustedPublicKey: async (id) => (id === keyId ? spki.toString('base64') : pinned.get(id) ?? null),
  };
  return { keyId, publicKey: spki.toString('base64'), signer, p1363, der: (bytes: Uint8Array) => sign('sha256', bytes, privateKey) };
}

/** The ledger of `sealedLedger`, sealed by `host` instead of the local key. */
async function hostSealedLedger(host: ReturnType<typeof es256HostSigner>) {
  const store = memoryEngine([LEDGER, AMENDMENTS] as never);
  const crypto = bindingCrypto();
  const now = DAY0 + 12 * H + 30 * 60_000;
  const sealer = new AuditSealer({ engine: store.engine, crypto, signer: () => host.signer, logger: recordingLogger(), now: () => now });
  store.hot.table('ledger_probe').push(row('r1', at(8, 10)), row('r2', at(8, 20)), row('r3', at(8, 30), null), row('r4', at(10, 5)), row('r5', at(11, 10), 'org_b'));
  await sealer.runPass();
  const checkpoint = (chain: string, sequence: number) => store.hot.table('sys_audit_checkpoint').find((r) => r.chain_key === chain && r.sequence === sequence)!;
  /** Re-sign a checkpoint row: `signing_key_id` set to `keyId`, the signature `signWith` makes over the new body. */
  const resign = (cp: Record<string, unknown>, keyId: string, signWith: (bytes: Uint8Array) => Buffer) => {
    const body = { ...checkpointBodyFromRow(cp), signing_key_id: keyId };
    cp.signing_key_id = keyId;
    cp.signature = signWith(signedBodyBytes(body)).toString('base64');
  };
  /** The live check under `trust` (default: the host's anchor), and its bundle re-judged offline under the trusted fingerprints. */
  const verifyNow = async (trust: Pick<IAuditCheckpointSigner, 'trustedPublicKey'> = host.signer) => {
    let bundle: AuditProofBundle | undefined;
    const report = await verifyAuditLedger({ engine: store.engine, crypto, trust, now: () => now, onProofBundle: (b) => { bundle = b; } });
    const copy = JSON.parse(JSON.stringify(bundle)) as AuditProofBundle;
    if (report.keys.trusted.length > 0) {
      expect(comparable(await verifyAuditProofBundle(copy, { trustedKeys: report.keys.trusted, now: () => now }))).toEqual(comparable(report));
    }
    return { report, bundle: copy };
  };
  return { ...store, crypto, checkpoint, resign, verifyNow };
}

/** A public key of a type the amended D4 does not admit, in the encoding a host might answer it in, under its own fingerprint. */
function foreignKey(kind: 'P-384' | 'RSA' | 'P-256 compressed' | 'Ed25519 SPKI'): { keyId: string; publicKey: string; signWith: (bytes: Uint8Array) => Buffer } {
  const pair = (): { privateKey: KeyObject; publicKey: KeyObject } =>
    kind === 'P-384' ? generateKeyPairSync('ec', { namedCurve: 'P-384' })
      : kind === 'RSA' ? generateKeyPairSync('rsa', { modulusLength: 2048 })
        : kind === 'Ed25519 SPKI' ? generateKeyPairSync('ed25519')
          : generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { privateKey, publicKey } = pair();
  let der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  if (kind === 'P-256 compressed') {
    // The same P-256 key, its point compressed: X9.62 0x02/0x03 || x, in the compressed-point SPKI prefix.
    const point = der.subarray(der.length - 65);
    const compressed = Buffer.concat([Buffer.from([0x02 + (point[64] & 1)]), point.subarray(1, 33)]);
    der = Buffer.concat([Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex'), compressed]);
  }
  const signWith = (bytes: Uint8Array) =>
    kind === 'Ed25519 SPKI' ? sign(null, bytes, privateKey)
      : kind === 'RSA' ? sign('sha256', bytes, privateKey)
        : sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return { keyId: createHash('sha256').update(der).digest('hex'), publicKey: der.toString('base64'), signWith };
}

describe('an ES256 host signer: the trusted key\'s type decides the algorithm (ADR-0154 D4, D6, amended)', () => {
  it('verifies a ledger an ES256 host signer sealed, live under its anchor and offline under its fingerprint', async () => {
    const host = es256HostSigner();
    const s = await hostSealedLedger(host);
    expect(s.checkpoint('org:org_a', 0).signing_key_id).toBe(host.keyId);
    const { report, bundle } = await s.verifyNow();
    expect(report.faults).toEqual([]);
    expect(report.totals.unmodified).toBe(5);
    expect(report.keys).toEqual({ trusted: [host.keyId], untrusted: [] });
    expect(report.ok).toBe(true);
    // The bundle carries the ES256 key as its SPKI DER, under the fingerprint of exactly those bytes.
    expect(bundle.keys).toEqual([{ fingerprint: host.keyId, public_key: host.publicKey }]);
  });

  it('refuses a forged ES256 signature: the checkpoint holds nothing', async () => {
    const host = es256HostSigner();
    const s = await hostSealedLedger(host);
    const cp = s.checkpoint('org:org_a', 0);
    const forged = Buffer.from(String(cp.signature), 'base64');
    forged[10] ^= 0x01;
    cp.signature = forged.toString('base64');
    const { report } = await s.verifyNow();
    expect(faultKinds(report)).toContain('org:org_a#0:signature');
    expect(verdicts(report)).toMatchObject({ r1: 'late!', r2: 'late!' });
    expect(report.ok).toBe(false);
  });

  it('refuses a valid ES256 signature in DER encoding: one encoding, r || s', async () => {
    const host = es256HostSigner();
    const s = await hostSealedLedger(host);
    s.resign(s.checkpoint('org:org_a', 0), host.keyId, host.der);
    const { report } = await s.verifyNow();
    expect(faultKinds(report)).toContain('org:org_a#0:signature');
    expect(report.ok).toBe(false);
  });

  it.each(['P-384', 'RSA', 'P-256 compressed', 'Ed25519 SPKI'] as const)(
    'trusts no %s key the anchor answers, though the record it signed is otherwise valid: it fails closed',
    async (kind) => {
      const host = es256HostSigner();
      const s = await hostSealedLedger(host);
      const foreign = foreignKey(kind);
      s.resign(s.checkpoint('org:org_a', 0), foreign.keyId, foreign.signWith);
      const anchor = { trustedPublicKey: async (id: string) => (id === foreign.keyId ? foreign.publicKey : host.signer.trustedPublicKey(id)) };
      const { report } = await s.verifyNow(anchor);
      expect(report.keys.untrusted).toEqual([foreign.keyId]);
      expect(faultKinds(report)).toContain('org:org_a#0:untrusted_key');
      expect(report.ok).toBe(false);
    },
  );

  it('never verifies an Ed25519 signature under an EC key: the record cannot choose the algorithm', async () => {
    const host = es256HostSigner();
    const s = await hostSealedLedger(host);
    const ed = generateKeyPairSync('ed25519');
    // 64 bytes, the length of an r || s signature, made by Ed25519 over the right body.
    s.resign(s.checkpoint('org:org_a', 0), host.keyId, (bytes) => sign(null, bytes, ed.privateKey));
    const { report } = await s.verifyNow();
    expect(faultKinds(report)).toContain('org:org_a#0:signature');
    expect(report.ok).toBe(false);
  });

  it('trusts no key the anchor answers under an id its bytes do not hash to: the id binds the key and its type', async () => {
    const host = es256HostSigner();
    const s = await hostSealedLedger(host);
    const alias = 'a'.repeat(64);
    s.resign(s.checkpoint('org:org_a', 0), alias, host.p1363);
    const anchor = { trustedPublicKey: async (id: string) => (id === alias ? host.publicKey : host.signer.trustedPublicKey(id)) };
    const { report } = await s.verifyNow(anchor);
    expect(report.keys.untrusted).toEqual([alias]);
    expect(faultKinds(report)).toContain('org:org_a#0:untrusted_key');
  });
});

describe('a host signer that takes over pins the local keys (ADR-0154 D6, amended)', () => {
  /** A key D6's own derivation trusts: its private half wrapped under its fingerprint, as a master-key holder could plant it. */
  async function plantOpeningKey(s: Awaited<ReturnType<typeof sealedLedger>>) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url');
    const fingerprint = createHash('sha256').update(raw).digest('hex');
    const context = signingKeyContext(fingerprint);
    const handle = await s.crypto.encrypt((privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64'), context);
    await writeAuditSealSecret(s.engine, handle, context);
    s.hot.table('sys_audit_signing_key').push({ id: 'planted', fingerprint, public_key: raw.toString('base64'), private_handle: handle.id, status: 'retired', created_at: at(0, 0), retired_at: at(0, 1) });
    return { fingerprint, signWith: (bytes: Uint8Array) => sign(null, bytes, privateKey) };
  }

  it('keeps the checkpoints the local key signed trusted after the switch, and a key planted after it untrusted', async () => {
    const s = await sealedLedger();
    // Before the switch: the operator's `os audit verify --out` lists each trusted fingerprint with its public key.
    const pins = (await s.bundleNow()).keys;
    expect(pins.map((k) => k.fingerprint)).toEqual([s.keyId]);
    const host = es256HostSigner(pins);
    // The switch: the host signer seals the next window, continuing the same chains.
    s.clock.now = DAY0 + 14 * H + 30 * 60_000;
    s.ledger.push(row('r6', at(13, 10)));
    const hostSealer = new AuditSealer({ engine: s.engine, crypto: s.crypto, signer: () => host.signer, logger: recordingLogger(), now: () => s.clock.now });
    await hostSealer.runPass();
    expect(s.checkpoint('org:org_a', 2).signing_key_id).toBe(host.keyId);
    expect(s.checkpoint('org:org_a', 0).signing_key_id).toBe(s.keyId);

    const live = (trust: Pick<IAuditCheckpointSigner, 'trustedPublicKey'>) => verifyAuditLedger({ engine: s.engine, crypto: s.crypto, trust, now: () => s.clock.now });
    let bundle: AuditProofBundle | undefined;
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, trust: host.signer, now: () => s.clock.now, onProofBundle: (b) => { bundle = b; } });
    expect(report.faults).toEqual([]);
    expect(report.totals.unmodified).toBe(6);
    expect(report.keys).toEqual({ trusted: [s.keyId, host.keyId].sort(), untrusted: [] });
    expect(report.ok).toBe(true);
    const offline = await verifyAuditProofBundle(JSON.parse(JSON.stringify(bundle)), { trustedKeys: [s.keyId, host.keyId], now: () => s.clock.now });
    expect(comparable(offline)).toEqual(comparable(report));

    // A key planted after the switch — one D6's own derivation would trust — signs nothing the host anchor vouches for.
    const planted = await plantOpeningKey(s);
    expect(await trustedSigningKey(s.engine, s.crypto, planted.fingerprint)).not.toBeNull();
    const cp = s.checkpoint('deployment', 0);
    const body = { ...checkpointBodyFromRow(cp), signing_key_id: planted.fingerprint };
    cp.signing_key_id = planted.fingerprint;
    cp.signature = planted.signWith(signedBodyBytes(body)).toString('base64');
    const tampered = await live(host.signer);
    expect(tampered.keys.untrusted).toEqual([planted.fingerprint]);
    expect(faultKinds(tampered)).toEqual(['deployment#0:untrusted_key']);
    expect(tampered.ok).toBe(false);
  });

  it('reads the local key\'s checkpoints untrusted under a host signer that pins nothing: the pin is the host\'s duty', async () => {
    const s = await sealedLedger();
    const host = es256HostSigner();
    const report = await verifyAuditLedger({ engine: s.engine, crypto: s.crypto, trust: host.signer, now: () => s.clock.now });
    expect(report.keys).toEqual({ trusted: [], untrusted: [s.keyId] });
    expect(new Set(report.faults.map((f) => f.kind))).toEqual(new Set(['untrusted_key']));
    expect(report.ok).toBe(false);
  });
});
