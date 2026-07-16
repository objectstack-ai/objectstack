// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @proof: readonly-static-write
//
// #2948 / #3003 — static `readonly: true` is SERVER-enforced on UPDATE, not a
// UI-only affordance. The #3003 field report: an approval-flow object declared
// `approval_status` / `approval_stage` as `readonly: true`, the create/edit
// forms never rendered them — and a logged-in, non-admin user forged all of
// them (plus an amount column) with one direct REST PATCH from the same
// session, self-approving a 4-stage approval. The strip added for #2948
// (`stripReadonlyFields`, objectql/engine.ts) closes exactly that: on a
// non-system UPDATE, caller-supplied writes to statically-readonly fields are
// silently dropped (HTTP 200, persisted value kept) — symmetric with the
// `readonlyWhen` strip. INSERT is deliberately exempt (a create may seed a
// readonly column: defaultValue, import, migration), matching `readonlyWhen`.
//
// Proven here on the REAL showcase app over HTTP: `showcase_contact.lead_score`
// is the stand-in for the #3003 approval/status/amount columns — readonly,
// "computed by scoring rules — not user-editable", never on the create form.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const OBJ = '/data/showcase_contact';
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;
const recordOf = (b: any) => b?.record ?? b?.data ?? b;

describe('showcase: static readonly write enforcement (#2948 / #3003)', () => {
  let stack: VerifyStack;
  let token: string;
  let contactId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn();
    token = await stack.signUp('ro-worker@verify.test');

    // INSERT exemption (documented contract, symmetric with `readonlyWhen`):
    // a create MAY seed a readonly column — the scoring pipeline, an import,
    // or a migration legitimately writes the initial value.
    const created = await stack.apiAs(token, 'POST', OBJ, {
      name: 'Readonly Probe',
      email: 'ro-probe@verify.test',
      lead_score: 10,
    });
    expect(created.status).toBeLessThan(300);
    contactId = idOf(await created.json());
    expect(contactId).toBeTruthy();
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('INSERT may seed the readonly field (documented exemption)', async () => {
    const res = await stack.apiAs(token, 'GET', `${OBJ}/${contactId}`);
    expect(res.status).toBe(200);
    expect(recordOf(await res.json()).lead_score, 'insert-seeded value persisted').toBe(10);
  });

  it('a direct PATCH forging the readonly field is silently stripped — sibling editable fields still land', async () => {
    // The #3003 move: same logged-in session, straight to the REST API with a
    // payload the UI would never produce.
    const forge = await stack.apiAs(token, 'PATCH', `${OBJ}/${contactId}`, {
      lead_score: 99999,
      notes: 'legitimate edit in the same payload',
    });
    // The strip is SILENT by contract (like `readonlyWhen`): 200, not 4xx.
    expect(forge.status, 'strip is silent — the request succeeds').toBe(200);

    const after = recordOf(await (await stack.apiAs(token, 'GET', `${OBJ}/${contactId}`)).json());
    expect(after.lead_score, 'forged readonly value must NOT persist').toBe(10);
    expect(after.notes, 'editable field from the same payload still lands').toBe(
      'legitimate edit in the same payload',
    );
  });

  it('a PATCH carrying ONLY the forged readonly field is a no-op on the record', async () => {
    const forge = await stack.apiAs(token, 'PATCH', `${OBJ}/${contactId}`, { lead_score: -1 });
    expect(forge.status).toBe(200);

    const after = recordOf(await (await stack.apiAs(token, 'GET', `${OBJ}/${contactId}`)).json());
    expect(after.lead_score, 'readonly value survives an all-forged payload').toBe(10);
  });
});
