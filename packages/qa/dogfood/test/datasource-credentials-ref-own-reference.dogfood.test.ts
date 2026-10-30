// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27762] A datasource saved through the metadata door may name, in
// `external.credentialsRef`, only the reference its own stored row already
// holds — the own-reference rule #27582 set (a non-system write may only seal
// a new value or keep its own record's stored reference), pinned at the REST
// door `PUT /api/v1/meta/datasource/:name` of a booted stack, as a signed-in
// non-system caller. `packages/metadata-protocol/src/protocol.datasource-credentials-ref-own-reference.test.ts`
// drives every face of the one save this door calls; this file holds the rule
// through the door a client writes through:
//
//  - a create naming a reference is refused (`VALIDATION_ERROR` / 400) before
//    anything is written, with one answer whatever the reference names, and
//    the reference is never echoed;
//  - an edit naming a reference other than its own is refused, and the stored
//    reference stays;
//  - the GET → edit → PUT round trip keeps the datasource's own reference.
//
// The stored rows are seeded through the protocol's server-stated rewrite (the
// system pass-through the rule keeps): this harness composes no secret binder,
// so no door here mints a reference.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const fixture = defineStack({
  manifest: {
    id: 'com.dogfood.datasource-credentials-ref', namespace: 'dcr', version: '0.0.0', type: 'app',
    name: 'Datasource credentials reference fixture', description: 'An app with one object, for its metadata door.',
  },
  objects: [
    ObjectSchema.create({
      name: 'dcr_note', label: 'Note', pluralLabel: 'Notes',
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
  ],
} as never);

/** Holds `OWN_REF`. */
const OWN = 'dcr_own_27762';
/** Another datasource, holding `OTHER_REF`. */
const OTHER = 'dcr_other_27762';
/** No row until a save makes one. */
const FRESH = 'dcr_fresh_27762';
const OWN_REF = 'sys_secret:dcr_own_27762';
const OTHER_REF = 'sys_secret:dcr_other_27762';
const UNHELD_REF = 'sys_secret:dcr_held_by_no_row_27762';

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

describe('[#27762] datasource `external.credentialsRef`: a non-system save through the metadata door may only keep its own stored reference', () => {
  let stack: VerifyStack;
  let ql: any;
  let token = '';

  const call = async (method: string, path: string, payload?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, payload);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  /** `{ status, code, message }` from the door's ADR-0112 envelope. */
  const refusalOf = (a: Answer) => {
    const error = a.json?.error;
    return typeof error === 'object' && error !== null
      ? { status: a.status, code: error.code, message: String(error.message ?? '') }
      : { status: a.status, code: a.json?.code, message: String(error ?? '') };
  };
  const storedRows = async (name: string): Promise<Array<Record<string, unknown>>> =>
    ql.find('sys_metadata', { where: { type: 'datasource', name }, context: SYS });
  const storedRef = async (name: string) => {
    const [row] = await storedRows(name);
    const raw = row?.metadata;
    return (typeof raw === 'string' ? JSON.parse(raw) : (raw as any))?.external?.credentialsRef;
  };
  const expectRuleRefusal = (a: Answer) => {
    expect({ status: a.status, code: refusalOf(a).code }, a.text).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    for (const ref of [OWN_REF, OTHER_REF, UNHELD_REF]) expect(a.text).not.toContain(ref);
  };

  beforeAll(async () => {
    stack = await bootStack(fixture);
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const protocol: any = await stack.kernel.getServiceAsync('protocol');
    for (const [name, ref] of [[OWN, OWN_REF], [OTHER, OTHER_REF]] as const) {
      await protocol.saveMetaItem({ type: 'datasource', name, item: body(name, name, ref), packageId: null, source: 'migrate-stored' });
      expect(await storedRef(name)).toBe(ref);
    }
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a create naming a reference is refused before anything is written, with one answer whatever it names', async () => {
    const other = await call('PUT', `/meta/datasource/${FRESH}`, body(FRESH, 'Fresh', OTHER_REF));
    const unheld = await call('PUT', `/meta/datasource/${FRESH}`, body(FRESH, 'Fresh', UNHELD_REF));
    expectRuleRefusal(other);
    expectRuleRefusal(unheld);
    expect(refusalOf(unheld)).toEqual(refusalOf(other));
    expect(await storedRows(FRESH)).toEqual([]);
  });

  it('an edit naming a reference other than its own is refused, and the stored reference stays', async () => {
    const refused = await call('PUT', `/meta/datasource/${OWN}`, body(OWN, 'Own (edited)', OTHER_REF));
    expectRuleRefusal(refused);
    expect(await storedRef(OWN)).toBe(OWN_REF);
    const [row] = await storedRows(OWN);
    expect(JSON.parse(String(row.metadata)).label).toBe(OWN);
  });

  it('the GET → edit → PUT round trip keeps the datasource\'s own reference', async () => {
    const read = await call('GET', `/meta/datasource/${OWN}`);
    expect(read.status, read.text).toBe(200);
    const served = Object.fromEntries(Object.entries(read.json.item ?? {}).filter(([k]) => !k.startsWith('_'))) as any;
    expect(served.external?.credentialsRef).toBe(OWN_REF);
    const saved = await call('PUT', `/meta/datasource/${OWN}`, { ...served, label: 'Own (round trip)' });
    expect(saved.status, saved.text).toBe(200);
    expect(await storedRef(OWN)).toBe(OWN_REF);
    const [row] = await storedRows(OWN);
    expect(JSON.parse(String(row.metadata)).label).toBe('Own (round trip)');
  });
});
