// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { AuditSealer } from './sealer.js';
import { bindingCrypto, memoryEngine, recordingLogger } from './seal-store.testkit.js';
import {
  amendmentRow,
  checkpointBodyFromRow,
  checkpointDigest,
  signedBodyBytes,
  type ExpiryAmendmentBody,
} from './signed-body.js';
import { LocalCheckpointSigner } from './signer.js';
import type { AuditExpiryRun } from './expiry.js';

/**
 * ADR-0154 D8 — what an expiry admits before it signs or deletes anything,
 * one check per test, over an in-memory engine double: each checkpoint it
 * takes and each stored expiry it follows is bound to the chain it is stored
 * under (its signed object and organization, not its unsigned columns), each
 * links to the one before it, and the stored amendments are read until an
 * admitted one answers. The sealer's chain head is read under the same rule.
 *
 * Every test here goes red when its one check is taken out alone. Fixtures
 * that need a body no sweep would write are signed here with the test's own
 * platform key: what is pinned is the check, not how such a row came to be.
 */

type Row = Record<string, unknown>;

const H = 60 * 60 * 1000;
const DAY = 24 * H;
const DAY0 = Date.UTC(2026, 10, 10);
const at = (h: number, m: number) => new Date(DAY0 + h * H + m * 60_000).toISOString();
const iso = (ms: number) => new Date(ms).toISOString();
const NO_SIGNATURE = Buffer.alloc(64).toString('base64');

const LEDGER = {
  name: 'ledger_probe',
  fields: { id: { type: 'text' }, created_at: { type: 'datetime' }, action: { type: 'text' }, tenant_id: { type: 'lookup' }, payload: { type: 'textarea' } },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'archive' }, seal: { valueFields: ['payload'] } },
};
const AMENDMENTS = { name: 'sys_audit_amendment', fields: {} };

const row = (id: string, created: string, tenant: string) => ({ id, created_at: created, action: 'update', tenant_id: tenant, payload: `{"v":"${id}"}` });

/** org_a sealed in windows 08, 09 and 10 (sequences 0–2), org_b in 08 and 09 (0–1), at 12:30. */
async function sealedLedger() {
  const store = memoryEngine([LEDGER, AMENDMENTS] as never);
  const crypto = bindingCrypto();
  const signer = new LocalCheckpointSigner({ engine: store.engine, crypto });
  const clock = { now: DAY0 + 12 * H + 30 * 60_000 };
  const logger = recordingLogger();
  const sealer = new AuditSealer({ engine: store.engine, crypto, signer: () => signer, logger, now: () => clock.now });
  const ledger = store.hot.table('ledger_probe');
  ledger.push(
    row('a0', at(8, 10), 'org_a'), row('a1', at(9, 10), 'org_a'), row('a2', at(10, 10), 'org_a'),
    row('b0', at(8, 20), 'org_b'), row('b1', at(9, 20), 'org_b'),
  );
  await sealer.runPass();
  const keyId = (await signer.activeKeyId())!;
  const checkpoints = () => store.hot.table('sys_audit_checkpoint');
  const checkpoint = (chain: string, sequence: number) => checkpoints().find((r) => r.chain_key === chain && r.sequence === sequence)!;
  const bodyOf = (chain: string, sequence: number) => checkpointBodyFromRow(checkpoint(chain, sequence));
  const digestOf = (chain: string, sequence: number) => checkpointDigest(bodyOf(chain, sequence));
  const amendments = () => store.hot.table('sys_audit_amendment');
  /** Replace a stored checkpoint row. */
  const put = (chain: string, sequence: number, next: Row) => {
    const list = checkpoints();
    list.splice(list.indexOf(checkpoint(chain, sequence)), 1, next);
  };
  /** Remove a chain's checkpoint and the rows it lists, as a finished expiry leaves it. */
  const removeExpired = (chain: string, sequence: number) => {
    const body = bodyOf(chain, sequence);
    for (const id of body.row_ids) ledger.splice(ledger.findIndex((r) => r.id === id), 1);
    checkpoints().splice(checkpoints().indexOf(checkpoint(chain, sequence)), 1);
  };
  /** A stored checkpoint with `change` applied to its signed body, signed again under the platform key. */
  const resigned = async (stored: Row, change: Row): Promise<Row> => {
    const body = checkpointBodyFromRow({ ...stored, ...change });
    const { signature } = await signer.sign(signedBodyBytes(body));
    return { ...stored, ...change, signature };
  };
  /** An expiry amendment row of org_a's chain, signed under the platform key unless `signature` is given. */
  const expiryRow = async (
    fields: { first: number; last: number; digest: string; tenant?: string; from?: string; to?: string },
    stored: { id?: string; signature?: string; chainKey?: string } = {},
  ): Promise<Row> => {
    const body: ExpiryAmendmentBody = {
      kind: 'expiry',
      sealed_object: 'ledger_probe',
      tenant_id: fields.tenant ?? 'org_a',
      amended_at: iso(clock.now),
      signing_key_id: keyId,
      first_sequence: fields.first,
      last_sequence: fields.last,
      covered_from: fields.from ?? at(8, 0),
      covered_to: fields.to ?? at(9, 0),
      last_removed_digest: fields.digest,
      policy: 'archive.keep',
      policy_value: '7d',
    };
    const signature = stored.signature ?? (await signer.sign(signedBodyBytes(body))).signature;
    const out = amendmentRow(body, { id: stored.id ?? `am_${amendments().length}`, signature });
    return stored.chainKey ? { ...out, chain_key: stored.chainKey } : out;
  };
  const amend = async (...args: Parameters<typeof expiryRow>) => {
    const stored = await expiryRow(...args);
    amendments().push(stored);
    return stored;
  };
  /** One sweep's expiry, 30 days on, under `archive.keep: 7d`. */
  const expireNow = async (): Promise<AuditExpiryRun[]> => {
    clock.now = DAY0 + 30 * DAY;
    return sealer.expire({ object: 'ledger_probe', policy: 'archive.keep', policyValue: '7d', cutoff: iso(clock.now - 7 * DAY) });
  };
  const warned = (pattern: RegExp) => logger.lines.filter((l) => l.level === 'warn' && pattern.test(l.message)).length;
  return { store, signer, sealer, clock, ledger, checkpoints, checkpoint, bodyOf, digestOf, amendments, put, removeExpired, resigned, amend, expiryRow, expireNow, warned };
}

const chainsOf = (runs: readonly AuditExpiryRun[]) => runs.map((r) => r.chain).sort();
const rowsOf = (runs: readonly AuditExpiryRun[], chain: string) => runs.find((r) => r.chain === chain)?.rowIds;

describe('a fresh expiry takes only checkpoints bound to the chain, each linked to the one before (ADR-0154 D8)', () => {
  it('a checkpoint stored under a chain it is not signed for expires nothing there', async () => {
    const s = await sealedLedger();
    s.checkpoints().push({ ...s.checkpoint('org:org_b', 0), id: 'misfiled', chain_key: 'org:aaa' });
    const runs = await s.expireNow();
    expect(chainsOf(runs)).toEqual(['org:org_a', 'org:org_b']);
    expect(s.warned(/chain 'org:aaa' is NOT expired: the checkpoint 0 stored under it is signed for another organization/)).toBe(1);
  });

  it('a chain whose checkpoints do not link one to the next is not expired at all', async () => {
    const s = await sealedLedger();
    s.put('org:org_a', 1, await s.resigned(s.checkpoint('org:org_a', 1), { previous_digest: 'f'.repeat(64) }));
    const runs = await s.expireNow();
    expect(chainsOf(runs)).toEqual(['org:org_b']);
    expect(s.warned(/chain 'org:org_a' is NOT expired: its checkpoint 1 does not link to the one before it/)).toBe(1);
  });

  it('the first remaining checkpoint links to the last expiry\'s last removed digest, or the chain is not expired', async () => {
    const s = await sealedLedger();
    await s.amend({ first: 0, last: 0, digest: 'f'.repeat(64) });
    s.removeExpired('org:org_a', 0);
    const runs = await s.expireNow();
    expect(chainsOf(runs)).toEqual(['org:org_b']);
    expect(s.warned(/chain 'org:org_a' is NOT expired: its checkpoint 1 does not link to the one before it \(or to the last expiry\)/)).toBe(1);
  });
});

describe('a stored expiry is resumed only over its own chain\'s checkpoints, as it signed them (ADR-0154 D8)', () => {
  const resumeRefused = /chain 'org:org_a' is NOT expired further: the range its expiry/;

  it('a checkpoint in the range that is signed for another chain deletes nothing', async () => {
    const s = await sealedLedger();
    s.put('org:org_a', 0, { ...s.checkpoint('org:org_b', 0), id: 'misfiled', chain_key: 'org:org_a' });
    await s.amend({ first: 0, last: 0, digest: s.digestOf('org:org_b', 0) });
    const runs = await s.expireNow();
    expect(rowsOf(runs, 'org:org_a')).toBeUndefined();
    expect(s.warned(/chain 'org:org_a' is NOT expired: the checkpoint 0 stored under it is signed for another/)).toBe(1);
  });

  it('the checkpoints of the range run consecutively', async () => {
    const s = await sealedLedger();
    // Sequence 1 gone, and a sequence 2 that links straight to 0: every other check passes.
    const skipping = await s.resigned(s.checkpoint('org:org_a', 2), { previous_digest: s.digestOf('org:org_a', 0) });
    s.put('org:org_a', 2, skipping);
    s.checkpoints().splice(s.checkpoints().indexOf(s.checkpoint('org:org_a', 1)), 1);
    await s.amend({ first: 0, last: 2, digest: checkpointDigest(checkpointBodyFromRow(skipping)), to: at(11, 0) });
    const runs = await s.expireNow();
    expect(rowsOf(runs, 'org:org_a')).toBeUndefined();
    expect(s.warned(resumeRefused)).toBe(1);
  });

  it('each checkpoint of the range links to the one before it', async () => {
    const s = await sealedLedger();
    const unlinked = await s.resigned(s.checkpoint('org:org_a', 1), { previous_digest: 'f'.repeat(64) });
    s.put('org:org_a', 1, unlinked);
    await s.amend({ first: 0, last: 1, digest: checkpointDigest(checkpointBodyFromRow(unlinked)), to: at(10, 0) });
    const runs = await s.expireNow();
    expect(rowsOf(runs, 'org:org_a')).toBeUndefined();
    expect(s.warned(resumeRefused)).toBe(1);
  });

  it('each checkpoint of the range verifies under a trusted key, though its body is the one the amendment names', async () => {
    const s = await sealedLedger();
    s.put('org:org_a', 0, { ...s.checkpoint('org:org_a', 0), signature: NO_SIGNATURE });
    await s.amend({ first: 0, last: 0, digest: s.digestOf('org:org_a', 0) });
    const runs = await s.expireNow();
    expect(rowsOf(runs, 'org:org_a')).toBeUndefined();
    expect(s.warned(resumeRefused)).toBe(1);
  });

  it('the range ends at the checkpoint whose digest the amendment carries', async () => {
    const s = await sealedLedger();
    await s.amend({ first: 0, last: 1, digest: 'f'.repeat(64), to: at(10, 0) });
    const runs = await s.expireNow();
    expect(rowsOf(runs, 'org:org_a')).toBeUndefined();
    expect(s.warned(resumeRefused)).toBe(1);
  });

  it('a checkpoint before the range is never taken into it', async () => {
    const s = await sealedLedger();
    await s.amend({ first: 1, last: 1, digest: s.digestOf('org:org_a', 1), from: at(9, 0), to: at(10, 0) });
    const runs = await s.expireNow();
    expect(rowsOf(runs, 'org:org_a')).toBeUndefined();
    expect(s.warned(resumeRefused)).toBe(1);
  });

  it('a stored expiry under the chain that is signed for another organization is never followed', async () => {
    const s = await sealedLedger();
    await s.amend({ first: 0, last: 0, digest: s.digestOf('org:org_a', 0), tenant: 'org_b' }, { id: 'misfiled_am', chainKey: 'org:org_a' });
    const runs = await s.expireNow();
    expect(rowsOf(runs, 'org:org_a')).toBeUndefined();
    expect(s.warned(/chain 'org:org_a' is NOT expired: the expiry amendment misfiled_am stored under it is signed for another/)).toBe(1);
  });

  it('a chain\'s last admitted expiry is found past any number of stored ones that are not admitted', async () => {
    const s = await sealedLedger();
    await s.amend({ first: 0, last: 0, digest: s.digestOf('org:org_a', 0) });
    s.removeExpired('org:org_a', 0);
    for (let i = 0; i < 50; i++) await s.amend({ first: 3, last: 10 + i, digest: 'f'.repeat(64) }, { id: `unsigned_${i}`, signature: NO_SIGNATURE });
    const runs = await s.expireNow();
    expect(rowsOf(runs, 'org:org_a')).toEqual(['a1', 'a2']);
  });
});

describe('the sealer\'s chain head follows only an admitted expiry bound to the chain (ADR-0154 D8)', () => {
  /** org_a expired whole (0–2), then a new row in window 13 sealed onto its head. */
  const sealedAfterExpiry = async (plant: (s: Awaited<ReturnType<typeof sealedLedger>>) => Promise<void>) => {
    const s = await sealedLedger();
    const last = s.digestOf('org:org_a', 2);
    await s.amend({ first: 0, last: 2, digest: last, to: at(11, 0) });
    for (const sequence of [0, 1, 2]) s.removeExpired('org:org_a', sequence);
    await plant(s);
    s.clock.now = DAY0 + 15 * H + 30 * 60_000;
    s.ledger.push(row('a3', at(13, 10), 'org_a'));
    await s.sealer.runPass();
    return { s, last };
  };

  it('never follows an expiry stored under the chain that is signed for another organization', async () => {
    const { s, last } = await sealedAfterExpiry(async (s) => {
      await s.amend({ first: 3, last: 9, digest: 'e'.repeat(64), tenant: 'org_b' }, { chainKey: 'org:org_a' });
    });
    expect(s.bodyOf('org:org_a', 3)).toMatchObject({ row_ids: ['a3'], previous_digest: last });
  });

  it('finds the admitted expiry past any number of stored ones that are not admitted', async () => {
    const { s, last } = await sealedAfterExpiry(async (s) => {
      for (let i = 0; i < 50; i++) await s.amend({ first: 3, last: 10 + i, digest: 'f'.repeat(64) }, { id: `unsigned_${i}`, signature: NO_SIGNATURE });
    });
    expect(s.bodyOf('org:org_a', 3)).toMatchObject({ row_ids: ['a3'], previous_digest: last });
  });
});

describe('an expiry removes only the seed sealed under each checkpoint\'s own coordinate (ADR-0154 D2, D8)', () => {
  it('a checkpoint whose seed handle names another secret removes nothing but its own row', async () => {
    const s = await sealedLedger();
    const secrets = () => s.store.hot.table('sys_secret');
    const keyHalf = secrets().find((r) => r.namespace === 'sys_audit_signing_key')!;
    const ownSeed = String(s.checkpoint('org:org_a', 1).seed_handle);
    // The chain's last checkpoint, so nothing that links to it changes.
    s.put('org:org_a', 2, await s.resigned(s.checkpoint('org:org_a', 2), { seed_handle: String(keyHalf.id) }));
    const runs = await s.expireNow();
    const run = runs.find((r) => r.chain === 'org:org_a')!;
    expect(run.rowIds).toEqual(['a0', 'a1', 'a2']);
    await run.complete();
    expect(secrets().some((r) => r.id === keyHalf.id)).toBe(true);
    expect(secrets().some((r) => r.id === ownSeed)).toBe(false);
    expect(s.checkpoints().filter((r) => r.chain_key === 'org:org_a')).toEqual([]);
  });
});
