// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27818] A datasource made active from a STORED body — a history version
// brought back by `POST /api/v1/meta/datasource/:name/rollback`, or a draft
// promoted by `POST /api/v1/meta/datasource/:name/publish` — may name, in
// `external.credentialsRef`, only the reference its active row holds now: the
// own-reference rule #27582 set (a non-system write may only seal a new value
// or keep its own record's stored reference), pinned at the REST doors of a
// booted stack as a signed-in non-system caller.
// `packages/metadata-protocol/src/protocol.datasource-credentials-ref-restore-doors.test.ts`
// drives every case at each door; this file holds the rule through the doors
// a client writes through:
//
//  - a rollback to a version naming a reference the row does not hold now is
//    refused (`VALIDATION_ERROR` / 400) before anything is written, and the
//    reference is never echoed; a rollback to a version naming the reference
//    the row holds keeps it;
//  - a publish of a draft naming a reference the active row does not hold is
//    refused the same way; a publish of a draft naming the one it holds keeps
//    it.
//
// The stored rows are seeded through the protocol's server-stated rewrite (the
// system pass-through the save door keeps), as rows stored before the rule, or
// before the row's reference moved, sit at rest: this harness composes no
// secret binder, so no door here mints a reference.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const fixture = defineStack({
  manifest: {
    id: 'com.dogfood.datasource-credentials-ref-restore', namespace: 'dcrr', version: '0.0.0', type: 'app',
    name: 'Datasource credentials reference restore fixture', description: 'An app with one object, for its metadata doors.',
  },
  objects: [
    ObjectSchema.create({
      name: 'dcrr_note', label: 'Note', pluralLabel: 'Notes',
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
  ],
} as never);

/** Restored by rollback. */
const ROLLED = 'dcrr_rolled_27818';
/** Published from a draft. */
const DRAFTED = 'dcrr_drafted_27818';
/** The reference each row holds now. */
const OWN_REF = 'sys_secret:dcrr_own_27818';
/** The reference `ROLLED` held before its reference moved. */
const FORMER_REF = 'sys_secret:dcrr_former_27818';
/** A reference no row holds. */
const UNHELD_REF = 'sys_secret:dcrr_held_by_no_row_27818';

const SYS = { isSystem: true };

/** A schema-valid datasource body, so every refusal below is the rule's and never a 422. */
const body = (name: string, label: string, credentialsRef?: string) => ({
  name,
  label,
  driver: 'postgres',
  config: { host: 'db.internal', database: name, username: 'app' },
  ...(credentialsRef === undefined ? {} : { external: { credentialsRef } }),
});

type Answer = { status: number; json: any; text: string };

describe('[#27818] datasource `external.credentialsRef`: a restore or publish may bring back only the reference its row holds now', () => {
  let stack: VerifyStack;
  let ql: any;
  let protocol: any;
  let token = '';
  /** The history version of `ROLLED` that names each label. */
  const versionOf = new Map<string, number>();

  const call = async (method: string, path: string, payload?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, payload);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  /** `{ status, code }` from the door's ADR-0112 envelope. */
  const codeOf = (a: Answer) => {
    const error = a.json?.error;
    return typeof error === 'object' && error !== null ? error.code : a.json?.code;
  };
  const activeBody = async (name: string) => {
    const rows: Array<Record<string, unknown>> = await ql.find('sys_metadata', { where: { type: 'datasource', name, state: 'active' }, context: SYS });
    expect(rows).toHaveLength(1);
    const raw = rows[0].metadata;
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
  };
  const expectRuleRefusal = (a: Answer) => {
    expect({ status: a.status, code: codeOf(a) }, a.text).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    for (const ref of [OWN_REF, FORMER_REF, UNHELD_REF]) expect(a.text).not.toContain(ref);
  };

  beforeAll(async () => {
    stack = await bootStack(fixture);
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    protocol = await stack.kernel.getServiceAsync('protocol');
    const seed = (name: string, label: string, ref?: string, mode?: 'draft') =>
      protocol.saveMetaItem({ type: 'datasource', name, item: body(name, label, ref), packageId: null, source: 'migrate-stored', ...(mode ? { mode } : {}) });
    // `ROLLED`: a version naming its former reference, then two naming the one it holds now.
    await seed(ROLLED, 'v1 (former reference)', FORMER_REF);
    await seed(ROLLED, 'v2 (own reference)', OWN_REF);
    await seed(ROLLED, 'v3 (own reference)', OWN_REF);
    const history: Array<Record<string, unknown>> = await ql.find('sys_metadata_history', { where: { type: 'datasource', name: ROLLED }, context: SYS });
    for (const row of history) {
      const raw = row.metadata;
      const label = (typeof raw === 'string' ? JSON.parse(raw) : (raw as any))?.label;
      if (typeof label === 'string') versionOf.set(label, Number(row.version));
    }
    expect([...versionOf.keys()].sort()).toEqual(['v1 (former reference)', 'v2 (own reference)', 'v3 (own reference)']);
    // `DRAFTED`: holds its own reference, with no draft yet.
    await seed(DRAFTED, 'Drafted', OWN_REF);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a rollback to a version naming a reference the row does not hold now is refused before anything is written', async () => {
    const refused = await call('POST', `/meta/datasource/${ROLLED}/rollback`, { toVersion: versionOf.get('v1 (former reference)') });
    expectRuleRefusal(refused);
    const active = await activeBody(ROLLED);
    expect(active.label).toBe('v3 (own reference)');
    expect(active.external?.credentialsRef).toBe(OWN_REF);
  });

  it('a rollback to a version naming the reference the row holds now keeps it', async () => {
    const restored = await call('POST', `/meta/datasource/${ROLLED}/rollback`, { toVersion: versionOf.get('v2 (own reference)') });
    expect(restored.status, restored.text).toBe(200);
    const active = await activeBody(ROLLED);
    expect(active.label).toBe('v2 (own reference)');
    expect(active.external?.credentialsRef).toBe(OWN_REF);
  });

  it('a publish of a draft naming a reference the active row does not hold is refused before anything is written', async () => {
    await protocol.saveMetaItem({
      type: 'datasource', name: DRAFTED, item: body(DRAFTED, 'Drafted (unheld)', UNHELD_REF), packageId: null, source: 'migrate-stored', mode: 'draft',
    });
    const refused = await call('POST', `/meta/datasource/${DRAFTED}/publish`, {});
    expectRuleRefusal(refused);
    const active = await activeBody(DRAFTED);
    expect(active.label).toBe('Drafted');
    expect(active.external?.credentialsRef).toBe(OWN_REF);
  });

  it('a publish of a draft naming the reference the active row holds keeps it', async () => {
    await protocol.saveMetaItem({
      type: 'datasource', name: DRAFTED, item: body(DRAFTED, 'Drafted (own)', OWN_REF), packageId: null, source: 'migrate-stored', mode: 'draft',
    });
    const published = await call('POST', `/meta/datasource/${DRAFTED}/publish`, {});
    expect(published.status, published.text).toBe(200);
    const active = await activeBody(DRAFTED);
    expect(active.label).toBe('Drafted (own)');
    expect(active.external?.credentialsRef).toBe(OWN_REF);
  });
});
