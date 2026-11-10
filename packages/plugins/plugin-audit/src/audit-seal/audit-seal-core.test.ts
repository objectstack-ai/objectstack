// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SysAuditLog } from '../objects/sys-audit-log.object.js';
import {
  AUDIT_SEAL_CANON_VERSION,
  CanonicalFormError,
  CanonicalJsonError,
  SignedBodyError,
  amendmentBodyFromRow,
  amendmentRow,
  canonicalDatetime,
  canonicalJson,
  chainKeyOf,
  checkpointBodyFromRow,
  checkpointDigest,
  checkpointRow,
  checkpointSeedContext,
  columnSalt,
  columnSaltsOf,
  commitValue,
  decodeCheckpointSeed,
  encodeCheckpointSeed,
  generateCheckpointSeed,
  inLeafOrder,
  isAuditSealSecretCoordinate,
  leafHash,
  leafInput,
  merkleRoot,
  nodeHash,
  rowIdOf,
  sealedColumnSet,
  signedBodyBytes,
  signingKeyContext,
  type CheckpointSignedBody,
  type ExpiryAmendmentBody,
  type RedactionAmendmentBody,
} from './index.js';

/**
 * ADR-0154 D1, D2, D4 — the pure core of the audit ledger's tamper evidence.
 * Every hash, commitment and signed byte the sealer and the verifier agree on
 * is built here, so each property below is one a verifier depends on.
 */

const sha = (...parts: Array<Uint8Array>) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

describe('RFC 8785 canonical JSON', () => {
  it('sorts members by UTF-16 code units and writes no whitespace', () => {
    // RFC 8785 §3.2.3's own ordering example, reduced: "\u20ac" (U+20AC) sorts
    // after "\r", "1" and "\u00e9", and before the surrogate pair of U+1F600.
    const value = { '\u20ac': 'Euro', '\r': 'CR', '1': 'One', '\u00e9': 'e', '\ud83d\ude00': 'Smiley', b: [1, { y: 2, x: 1 }] };
    expect(canonicalJson(value)).toBe(
      '{"\\r":"CR","1":"One","b":[1,{"x":1,"y":2}],"\u00e9":"e","\u20ac":"Euro","\ud83d\ude00":"Smiley"}',
    );
  });

  it('writes numbers in the ECMAScript form RFC 8785 §3.2.2.3 names', () => {
    expect(canonicalJson([1e21, 333333333.33333329, -0, 1e-7, 4.5])).toBe('[1e+21,333333333.3333333,0,1e-7,4.5]');
  });

  it('refuses every value that has no JSON form instead of coercing it', () => {
    for (const bad of [Number.NaN, Infinity, undefined, () => 1, 10n, new Date(0), Buffer.from('x'), { a: undefined }, '\ud800']) {
      expect(() => canonicalJson(bad), String(bad)).toThrow(CanonicalJsonError);
    }
  });
});

describe('canonical form of a sealed row (D1)', () => {
  const types = { created_at: { type: 'datetime' }, flag: { type: 'boolean' }, day: { type: 'date' } };

  it('spells one instant one way, whatever the driver handed back', () => {
    const expected = '2026-11-10T05:06:07.089Z';
    for (const raw of [
      new Date(expected),
      expected,
      '2026-11-10T05:06:07.089+00:00',
      '2026-11-10T13:06:07.089+08:00',
      '2026-11-10 05:06:07.089',
      Date.parse(expected),
    ]) {
      expect(canonicalDatetime(raw), String(raw)).toBe(expected);
    }
    expect(() => canonicalDatetime('yesterday')).toThrow(CanonicalFormError);
  });

  it('reads a driver boolean and date the same in either spelling', () => {
    const salts = () => Buffer.alloc(32);
    const cols = { clear: ['created_at', 'day', 'flag', 'id'], committed: [] };
    const a = leafInput({ id: 'r1', created_at: new Date('2026-01-01T00:00:00Z'), flag: 1, day: '2026-01-02' }, cols, types, salts);
    const b = leafInput({ id: 'r1', created_at: '2026-01-01 00:00:00', flag: true, day: new Date('2026-01-02T00:00:00Z') }, cols, types, salts);
    expect(a).toEqual(b);
    expect(leafHash(a).equals(leafHash(b))).toBe(true);
  });

  it("takes sys_audit_log's declared fields: three value columns committed, the rest in clear", () => {
    const set = sealedColumnSet(SysAuditLog.fields, ['old_value', 'new_value', 'metadata']);
    expect(set).toEqual({
      clear: ['action', 'actor', 'created_at', 'id', 'ip_address', 'object_name', 'record_id', 'tenant_id', 'user_agent', 'user_id'],
      committed: ['metadata', 'new_value', 'old_value'],
    });
  });

  it('refuses a value field that is not declared, and id or created_at as a value field', () => {
    const fields = { id: {}, created_at: { type: 'datetime' }, body: {} };
    expect(() => sealedColumnSet(fields, ['nope'])).toThrow(CanonicalFormError);
    expect(() => sealedColumnSet(fields, ['id'])).toThrow(CanonicalFormError);
    expect(() => sealedColumnSet({ id: {}, body: {} }, ['body'])).toThrow(CanonicalFormError);
  });

  it('commits a value as SHA-256(salt ‖ JCS(value)), absent and null alike', () => {
    const salt = Buffer.alloc(32, 7);
    expect(commitValue(salt, { a: 1 })).toBe(sha(salt, Buffer.from('{"a":1}')).toString('hex'));
    const cols = { clear: ['created_at', 'id'], committed: ['body'] };
    const at = '2026-01-01T00:00:00.000Z';
    const absent = leafInput({ id: 'r', created_at: at }, cols, types, () => salt);
    const nulled = leafInput({ id: 'r', created_at: at, body: null }, cols, types, () => salt);
    const filled = leafInput({ id: 'r', created_at: at, body: 'x' }, cols, types, () => salt);
    expect(absent).toEqual(nulled);
    expect(absent.body).toBe(commitValue(salt, null));
    expect(filled.body).not.toBe(absent.body);
  });

  it('hashes a leaf as SHA-256(0x00 ‖ JCS(leaf input)), and an override replaces one commitment only', () => {
    const cols = { clear: ['created_at', 'id'], committed: ['a', 'b'] };
    const row = { id: 'r', created_at: '2026-01-01T00:00:00.000Z', a: 'one', b: 'two' };
    const leaf = leafInput(row, cols, types, (_id, c) => Buffer.alloc(32, c.charCodeAt(0)));
    expect(leafHash(leaf).equals(sha(Uint8Array.of(0), Buffer.from(canonicalJson(leaf))))).toBe(true);
    const rebuilt = leafInput({ ...row, a: 'redacted' }, cols, types, (_id, c) => Buffer.alloc(32, c.charCodeAt(0)), { a: leaf.a as string });
    expect(rebuilt).toEqual(leaf);
  });

  it('orders leaves by canonical created_at, then id, across driver spellings', () => {
    const rows = [
      { id: 'b', created_at: '2026-01-01 00:00:01' },
      { id: 'a', created_at: new Date('2026-01-01T00:00:01Z') },
      { id: 'c', created_at: '2026-01-01T00:00:00.500Z' },
    ];
    expect(inLeafOrder(rows).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('seed salts and secret coordinates (D2, D6)', () => {
  it('derives HMAC-SHA-256(seed, object ‖ 0 ‖ id ‖ 0 ‖ column), distinct per coordinate', () => {
    const seed = Buffer.alloc(32, 1);
    const salt = columnSalt(seed, 'sys_audit_log', 'r1', 'old_value');
    expect(salt).toHaveLength(32);
    expect(columnSaltsOf(seed, 'sys_audit_log')('r1', 'old_value').equals(salt)).toBe(true);
    const others = [
      columnSalt(seed, 'sys_audit_log', 'r1', 'new_value'),
      columnSalt(seed, 'sys_audit_log', 'r2', 'old_value'),
      columnSalt(seed, 'sys_other', 'r1', 'old_value'),
      columnSalt(Buffer.alloc(32, 2), 'sys_audit_log', 'r1', 'old_value'),
      // The separator keeps a shifted boundary from colliding.
      columnSalt(seed, 'sys_audit_log', 'r1o', 'ld_value'),
    ];
    for (const other of others) expect(other.equals(salt)).toBe(false);
  });

  it('round-trips a seed through its sealed text and refuses any other length', () => {
    const seed = generateCheckpointSeed();
    expect(decodeCheckpointSeed(encodeCheckpointSeed(seed)).equals(seed)).toBe(true);
    expect(() => encodeCheckpointSeed(Buffer.alloc(16))).toThrow();
    expect(() => decodeCheckpointSeed(Buffer.alloc(31).toString('base64'))).toThrow();
  });

  it('seals a seed at its checkpoint coordinate under audit_seal, with no tenantId', () => {
    expect(checkpointSeedContext('sys_audit_log', 'org_1', 42)).toEqual({ scope: 'audit_seal', namespace: 'sys_audit_log', key: '["org_1",42]' });
    expect(checkpointSeedContext('sys_audit_log', null, 0)).toEqual({ scope: 'audit_seal', namespace: 'sys_audit_log', key: '[null,0]' });
    expect(signingKeyContext('ab'.repeat(32))).toEqual({ scope: 'audit_seal', namespace: 'sys_audit_signing_key', key: 'ab'.repeat(32) });
    expect(() => checkpointSeedContext('sys_audit_log', null, -1)).toThrow();
  });

  it('recognises the coordinates it writes, and no other producer\'s', () => {
    expect(isAuditSealSecretCoordinate('sys_audit_log', '["org_1",42]')).toBe(true);
    expect(isAuditSealSecretCoordinate('sys_audit_log', '[null,0]')).toBe(true);
    expect(isAuditSealSecretCoordinate('sys_audit_signing_key', 'ab12')).toBe(true);
    for (const [ns, key] of [
      ['mail', 'smtp_password'],
      ['smtp_account', 'password'],
      ['datasource', 'main'],
      ['x', '[ "org_1", 42 ]'],
      ['x', '["org_1",-1]'],
      ['x', '["org_1",1.5]'],
      ['x', '[1,2]'],
      ['x', '["a","b"]'],
      ['x', '[not json'],
    ]) {
      expect(isAuditSealSecretCoordinate(ns, key), `${ns}/${key}`).toBe(false);
    }
  });
});

describe('the Merkle tree (D1, RFC 6962 domain separation)', () => {
  const leaf = (n: number) => sha(Buffer.from([n]));

  it('takes one leaf as its own root', () => {
    expect(merkleRoot([leaf(1)])).toBe(leaf(1).toString('hex'));
  });

  it('builds pairwise with the 0x01 node prefix and promotes an odd last node unchanged', () => {
    const [a, b, c] = [leaf(1), leaf(2), leaf(3)];
    expect(nodeHash(a, b).equals(sha(Uint8Array.of(1), a, b))).toBe(true);
    expect(merkleRoot([a, b, c])).toBe(nodeHash(nodeHash(a, b), c).toString('hex'));
    const five = [1, 2, 3, 4, 5].map(leaf);
    expect(merkleRoot(five)).toBe(
      nodeHash(nodeHash(nodeHash(five[0], five[1]), nodeHash(five[2], five[3])), five[4]).toString('hex'),
    );
  });

  it('changes when a leaf changes or two leaves swap', () => {
    const leaves = [1, 2, 3, 4].map(leaf);
    const root = merkleRoot(leaves);
    expect(merkleRoot([leaves[1], leaves[0], leaves[2], leaves[3]])).not.toBe(root);
    expect(merkleRoot([leaves[0], leaves[1], leaves[2], leaf(9)])).not.toBe(root);
  });

  it('has no root for an empty window, and takes only 32-byte hashes', () => {
    expect(() => merkleRoot([])).toThrow();
    expect(() => merkleRoot([Buffer.alloc(31)])).toThrow();
  });
});

describe('signed bodies (D4, D7, D8)', () => {
  const body: CheckpointSignedBody = {
    sealed_object: 'sys_audit_log',
    tenant_id: 'org_1',
    sequence: 3,
    kind: 'window',
    window_start: '2026-11-10T04:00:00.000Z',
    window_end: '2026-11-10T05:00:00.000Z',
    sealed_through: '2026-11-10T05:00:00.000Z',
    leaf_count: 2,
    row_ids: ['r1', 'r2'],
    root: 'a'.repeat(64),
    previous_digest: 'b'.repeat(64),
    columns: { clear: ['created_at', 'id'], committed: ['old_value'] },
    canon_version: AUDIT_SEAL_CANON_VERSION,
    seed_handle: 'sec_0123',
    fencing_token: '17',
    sealed_at: '2026-11-10T05:10:00.000Z',
    signing_key_id: 'c'.repeat(64),
  };

  it('stores a checkpoint with a non-null chain key and reads the same body back from driver spellings', () => {
    const row = checkpointRow(body, { id: 'cp1', signature: 'sig' });
    expect(row).toMatchObject({ id: 'cp1', chain_key: 'org:org_1', signature: 'sig', row_ids: '["r1","r2"]' });
    const driverRow = {
      ...row,
      sequence: '3',
      leaf_count: '2',
      window_start: new Date(body.window_start),
      window_end: '2026-11-10 05:00:00',
      sealed_at: Date.parse(body.sealed_at),
      fencing_token: 17,
    };
    const back = checkpointBodyFromRow(driverRow);
    expect(back).toEqual(body);
    expect(checkpointDigest(back)).toBe(checkpointDigest(body));
    expect(Object.keys(back)).not.toContain('signature');
    expect(Object.keys(back)).not.toContain('chain_key');
    expect(Object.keys(back)).not.toContain('id');
  });

  it('keys the deployment chain apart from every organization, with a NULL tenant in the body', () => {
    expect(chainKeyOf(null)).toBe('deployment');
    expect(chainKeyOf('deployment')).toBe('org:deployment');
    const first = { ...body, tenant_id: null, sequence: 0, previous_digest: null };
    expect(checkpointRow(first, { id: 'cp0', signature: 's' })).toMatchObject({ chain_key: 'deployment', tenant_id: null });
  });

  it('digests the signed bytes, so a change to any signed field moves the digest', () => {
    expect(checkpointDigest(body)).toBe(sha(signedBodyBytes(body)).toString('hex'));
    const digest = checkpointDigest(body);
    for (const changed of [
      { ...body, root: 'd'.repeat(64) },
      { ...body, row_ids: ['r1', 'r3'] },
      { ...body, tenant_id: 'org_2' },
      { ...body, sealed_through: '2026-11-10T06:00:00.000Z' },
      { ...body, seed_handle: 'sec_other' },
    ]) {
      expect(checkpointDigest(checkpointBodyFromRow(changed))).not.toBe(digest);
    }
  });

  it('refuses a body that cannot be what a sealer wrote', () => {
    for (const bad of [
      { ...body, leaf_count: 3 },
      { ...body, row_ids: [], leaf_count: 0 },
      { ...body, row_ids: ['r1', 'r1'] },
      { ...body, sequence: 0 },
      { ...body, previous_digest: null },
      { ...body, root: 'A'.repeat(64) },
      { ...body, kind: 'other' },
      { ...body, canon_version: 2 },
      { ...body, window_end: body.window_start },
      { ...body, columns: { clear: ['id', 'created_at'], committed: [] } },
      { ...body, columns: { clear: ['id'], committed: ['id'] } },
      { ...body, fencing_token: '-1' },
    ]) {
      expect(() => checkpointBodyFromRow(bad as unknown as Record<string, unknown>), JSON.stringify(bad).slice(0, 80)).toThrow(SignedBodyError);
    }
  });

  it('stores amendments of either kind with the other kind\'s columns empty, and reads them back', () => {
    const redaction: RedactionAmendmentBody = {
      kind: 'redaction',
      sealed_object: 'sys_audit_log',
      tenant_id: null,
      amended_at: '2026-11-10T06:00:00.000Z',
      signing_key_id: 'c'.repeat(64),
      checkpoint_id: 'cp1',
      row_id: 'r1',
      column_name: 'new_value',
      sealed_commitment: 'e'.repeat(64),
      rewritten_commitment: 'f'.repeat(64),
      rewritten_by: 'audit-metadata-bodies',
    };
    const expiry: ExpiryAmendmentBody = {
      kind: 'expiry',
      sealed_object: 'sys_audit_log',
      tenant_id: 'org_1',
      amended_at: '2033-11-10T06:00:00.000Z',
      signing_key_id: 'c'.repeat(64),
      first_sequence: 0,
      last_sequence: 4,
      covered_from: '2026-11-10T00:00:00.000Z',
      covered_to: '2026-11-10T05:00:00.000Z',
      last_removed_digest: 'b'.repeat(64),
      policy: 'archive.keep',
      policy_value: '7y',
    };
    const r = amendmentRow(redaction, { id: 'a1', signature: 's' });
    expect(r).toMatchObject({ chain_key: 'deployment', first_sequence: null, policy: null });
    expect(amendmentBodyFromRow(r)).toEqual(redaction);
    const e = amendmentRow(expiry, { id: 'a2', signature: 's' });
    expect(e).toMatchObject({ chain_key: 'org:org_1', row_id: null, sealed_commitment: null });
    expect(amendmentBodyFromRow({ ...e, first_sequence: '0', covered_to: new Date(expiry.covered_to) })).toEqual(expiry);
    expect(() => amendmentBodyFromRow({ ...e, first_sequence: 5 })).toThrow(SignedBodyError);
  });
});

describe('a refusal never echoes the value it refused (D2: value columns stay on the host)', () => {
  // A value column holds audit payloads (old_value, new_value, metadata). An
  // error message is logged, so it names the column and the type, never the value.
  const SECRET = 'hunter2-old-password';
  const messageOf = (fn: () => unknown): string => {
    try { fn(); } catch (err) { return (err as Error).message; }
    throw new Error('expected a refusal');
  };
  const types = { created_at: { type: 'datetime' }, flag: { type: 'boolean' }, when: { type: 'datetime' } };
  const cols = (committed: string[]) => ({ clear: ['created_at', 'id'], committed });
  const row = (extra: Record<string, unknown>) => ({ id: 'r', created_at: '2026-01-01T00:00:00.000Z', ...extra });
  const salt = () => Buffer.alloc(32);

  it.each([
    ['an unparseable datetime', () => leafInput(row({ when: SECRET }), cols(['when']), types, salt), 'when'],
    ['a non-boolean', () => leafInput(row({ flag: SECRET }), cols(['flag']), types, salt), 'flag'],
    ['a datetime read directly', () => canonicalDatetime(SECRET, 'created_at'), 'created_at'],
    ['a value JCS cannot write', () => commitValue(Buffer.alloc(32), { note: SECRET, n: Number.NaN }), 'n'],
    ['a row with an unusable id', () => rowIdOf({ id: { token: SECRET } }), 'id'],
  ] as const)('%s names the column and the type, not the value', (_label, fn, column) => {
    const message = messageOf(fn);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('NaN');
    if (column !== 'id') expect(message).toContain(column);
  });
});

describe('the deployment chain signs a NULL organization (D5)', () => {
  it('writes "tenant_id":null into the signed bytes, and no organization key at all', () => {
    const body: CheckpointSignedBody = {
      sealed_object: 'sys_audit_log',
      tenant_id: null,
      sequence: 0,
      kind: 'window',
      window_start: '2026-11-10T04:00:00.000Z',
      window_end: '2026-11-10T05:00:00.000Z',
      sealed_through: '2026-11-10T05:00:00.000Z',
      leaf_count: 1,
      row_ids: ['r1'],
      root: 'a'.repeat(64),
      previous_digest: null,
      columns: { clear: ['created_at', 'id'], committed: [] },
      canon_version: AUDIT_SEAL_CANON_VERSION,
      seed_handle: 'sec_0',
      fencing_token: '1',
      sealed_at: '2026-11-10T05:10:00.000Z',
      signing_key_id: 'c'.repeat(64),
    };
    // Read back from the stored row, as a verifier does.
    const stored = checkpointRow(body, { id: 'cp0', signature: 's' });
    const text = signedBodyBytes(checkpointBodyFromRow(stored)).toString('utf8');
    expect(text).toContain('"tenant_id":null');
    // The stored-only key never enters the signed bytes.
    expect(text).not.toContain('chain_key');
    expect(text).not.toContain('deployment');
  });
});
