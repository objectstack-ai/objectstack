// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ROW_VERDICTS,
  amendmentRow,
  canonicalJson,
  canonicalValue,
  checkpointBodyFromRow,
  checkpointDigest,
  checkpointSeedContext,
  columnSaltsOf,
  commitValue,
  decodeCheckpointSeed,
  signedBodyBytes,
  verifyAuditLedger,
  type AmendmentSignedBody,
  type AuditVerifyReport,
  type CheckpointSignedBody,
  type ExpiryAmendmentBody,
  type RedactionAmendmentBody,
} from './index.js';
import { bindingCrypto, memoryEngine, recordingLogger } from './seal-store.testkit.js';
import { AuditSealer } from './sealer.js';
import { LocalCheckpointSigner, readAuditSealSecret } from './signer.js';

/**
 * ADR-0154 D9 — the live check over an in-memory engine double: per-row
 * verdicts against each checkpoint's leaf hashes, the trusted keys only, the
 * links of each chain, the scope flags, and the D7 / D8 acceptance rules over
 * hand-built amendments (their writers come with P3 and P4).
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
  const verifyNow = (extra: { orgs?: string[]; from?: Date; to?: Date } = {}) =>
    verifyAuditLedger({ engine: store.engine, crypto, now: () => clock.now, ...extra });
  const keyId = (await signer.activeKeyId())!;
  /** A trusted amendment row, signed by the deployment's key. */
  const amend = async (body: Omit<RedactionAmendmentBody, 'signing_key_id'> | Omit<ExpiryAmendmentBody, 'signing_key_id'>, id = `am_${store.hot.table('sys_audit_amendment').length}`) => {
    const full = { ...body, signing_key_id: keyId } as AmendmentSignedBody;
    const { signature } = await signer.sign(signedBodyBytes(full));
    store.hot.table('sys_audit_amendment').push(amendmentRow(full, { id, signature }));
    return id;
  };
  /** The commitment of `value` for column `payload` of `rowId`, under the salt of the checkpoint holding it. */
  const commitmentOf = async (cp: Record<string, unknown>, rowId: string, value: string) => {
    const body = checkpointBodyFromRow(cp);
    const handle = await readAuditSealSecret(store.engine, body.seed_handle);
    const seed = decodeCheckpointSeed(await crypto.decrypt(handle!, checkpointSeedContext(body.sealed_object, body.tenant_id, body.sequence)));
    return commitValue(columnSaltsOf(seed, 'ledger_probe')(rowId, 'payload'), canonicalValue(value, { type: 'textarea' }));
  };
  return { ...store, crypto, signer, sealer, clock, ledger, checkpoints, checkpoint, verifyNow, keyId, amend, commitmentOf };
}

/** Each row that is not unmodified, as `id: verdict` (`late!` for an unsealed late row). */
const verdicts = (report: AuditVerifyReport) =>
  Object.fromEntries(report.rows.map((r) => [r.row, r.verdict === 'late' && !r.sealed ? 'late!' : r.verdict]));
const faultCodes = (report: AuditVerifyReport) => report.faults.map((f) => `${f.chain}#${f.sequence ?? '-'}:${f.code}`).sort();

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
    expect(faultCodes(report)).toEqual(['org:org_b#0:untrusted_key']);
    expect(report.keys.untrusted).toEqual([planted.fingerprint]);
    expect(report.keys.trusted).toEqual([s.keyId]);
    expect(verdicts(report)).toEqual({ r5: 'late!' });
    expect(report.ok).toBe(false);
  });

  it('refuses a checkpoint whose signed fields were changed: the signature fails, and the next link with it', async () => {
    const s = await sealedLedger();
    s.checkpoint('org:org_a', 0).sealed_at = at(12, 0);
    const report = await s.verifyNow();
    expect(faultCodes(report)).toEqual(['org:org_a#0:signature', 'org:org_a#1:link']);
    expect(verdicts(report)).toEqual({ r1: 'late!', r2: 'late!' });
  });

  it('refuses two checkpoints at one sequence of one chain: neither holds anything', async () => {
    const s = await sealedLedger();
    s.checkpoints().push({ ...s.checkpoint('org:org_b', 0), id: 'twin' });
    const report = await s.verifyNow();
    expect(faultCodes(report)).toEqual(['org:org_b#0:duplicate']);
    expect(verdicts(report)).toEqual({ r5: 'late!' });
  });

  it('reports a checkpoint row that is not a signed body as malformed: the run fails', async () => {
    const s = await sealedLedger();
    s.checkpoint('org:org_b', 0).row_ids = '["r5","r5"]';
    const report = await s.verifyNow();
    expect(faultCodes(report)).toEqual(['org:org_b#-:malformed']);
    expect(report.ok).toBe(false);
  });

  it('refuses a stored chain key that disagrees with the signed organization', async () => {
    const s = await sealedLedger();
    s.checkpoint('org:org_b', 0).chain_key = 'org:org_z';
    expect(faultCodes(await s.verifyNow())).toEqual(['org:org_b#0:chain_key']);
  });
});

describe('a checkpoint holds its rows only through its signed root and its seed', () => {
  it('refuses leaf hashes that do not rebuild the signed root: the checkpoint holds nothing', async () => {
    const s = await sealedLedger();
    const cp = s.checkpoint('org:org_a', 0);
    const hashes = JSON.parse(String(cp.leaf_hashes)) as string[];
    cp.leaf_hashes = canonicalJson([hashes[1], hashes[0]]);
    const report = await s.verifyNow();
    expect(faultCodes(report)).toEqual(['org:org_a#0:leaf_hashes']);
    expect(report.faults[0].message).toMatch(/do not rebuild the signed root/);
    expect(verdicts(report)).toEqual({ r1: 'late!', r2: 'late!' });
  });

  it('refuses leaf hashes of another length than the row ids and the leaf count', async () => {
    const s = await sealedLedger();
    const cp = s.checkpoint('org:org_a', 0);
    cp.leaf_hashes = canonicalJson((JSON.parse(String(cp.leaf_hashes)) as string[]).slice(0, 1));
    const report = await s.verifyNow();
    expect(faultCodes(report)).toEqual(['org:org_a#0:leaf_hashes']);
    expect(report.faults[0].message).toMatch(/1 hash\(es\) for 2 row id\(s\) and a leaf count of 2/);
  });

  it('refuses a checkpoint whose seed is gone', async () => {
    const s = await sealedLedger();
    const handle = checkpointBodyFromRow(s.checkpoint('org:org_b', 0)).seed_handle;
    const secrets = s.hot.table('sys_secret');
    secrets.splice(secrets.findIndex((r) => r.id === handle), 1);
    const report = await s.verifyNow();
    expect(faultCodes(report)).toEqual(['org:org_b#0:seed']);
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
    expect(faultCodes(report)).toEqual(['org:org_a#1:gap']);
    expect(verdicts(report)).toEqual({ r4: 'late!' });
  });

  it('checks links outside --from/--to, and judges rows only inside', async () => {
    const s = await sealedLedger();
    s.checkpoint('org:org_a', 0).sealed_at = at(12, 0);
    s.ledger.find((r) => r.id === 'r5')!.payload = 'x';
    const report = await s.verifyNow({ from: new Date(at(10, 30)), to: new Date(at(11, 0)) });
    expect(faultCodes(report)).toEqual(['org:org_a#0:signature', 'org:org_a#1:link']);
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
    expect(report.faults.map((f) => [f.code, f.amendment])).toEqual([['untrusted_key', 'forged']]);
  });

  it('ignores an amendment for a row or a column the named checkpoint does not seal as a commitment', async () => {
    const s = await sealedLedger();
    await s.amend({ ...(await redaction(s, 'r1', '[masked]')), checkpoint_sequence: 1 }); // sequence 1 lists r4, not r1
    await s.amend({ ...(await redaction(s, 'r2', '[masked]')), column_name: 'action' });
    s.ledger.find((r) => r.id === 'r1')!.payload = '[masked]';
    s.ledger.find((r) => r.id === 'r2')!.payload = '[masked]';
    expect(verdicts(await s.verifyNow())).toEqual({ r1: 'modified', r2: 'modified' });
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
    expect(faultCodes(await s.verifyNow())).toEqual(['org:org_a#-:expiry', 'org:org_a#0:gap']);
  });

  it('refuses an expiry that does not start at the chain front', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    await expire(s, { first: 1, last: 1 });
    expect(faultCodes(await s.verifyNow())).toEqual(['org:org_a#-:expiry', 'org:org_a#0:gap']);
  });

  it('refuses an expiry whose carried digest is not what the first remaining checkpoint links to', async () => {
    const s = await sealedLedger();
    s.clock.now = DAY0 + 30 * 24 * H;
    await expire(s, { digest: 'f'.repeat(64) });
    expect(faultCodes(await s.verifyNow())).toEqual(['org:org_a#1:link']);
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
  });
});
