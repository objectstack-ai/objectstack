// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @proof: readonly-static-write
//
// ADR-0056 D10 — the authz-conformance matrix row this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976). Note
// the two vocabularies coincide here by accident, not by rule: the `@proof:`
// id above is an ADR-0054 liveness id, `authz-row:` below is a matrix row id.
// authz-row: readonly-static-write
//
// #2948 / #3003 (UPDATE) + #3043 (INSERT) — static `readonly: true` is
// SERVER-enforced on BOTH write paths, not a UI-only affordance. The #3003
// field report: an approval-flow object declared `approval_status` /
// `approval_stage` as `readonly: true`, the create/edit forms never rendered
// them — and a logged-in, non-admin user forged all of them (plus an amount
// column) with one direct REST PATCH from the same session, self-approving a
// 4-stage approval. #3043 is the INSERT face of the same gap: the create path
// used to be EXEMPT, so the same non-admin could skip the draft entirely and
// POST a record already `approval_status:'approved'` — a step SHORTER than
// #3003, and one the UPDATE strip never reached. It is now closed on both
// paths: UPDATE in the engine (`stripReadonlyFields`, objectql/engine.ts,
// #2948) and INSERT at the DataProtocol create INGRESS
// (metadata-protocol/protocol.ts `stripReadonlyForInsert`, #3043 — the single
// seam every external REST/GraphQL/MCP create funnels through, while trusted
// internal engine.insert writers are untouched). On a non-system INSERT or
// UPDATE, caller-supplied writes to statically-readonly fields are silently
// dropped (HTTP 2xx; a stripped INSERT field falls back to its `defaultValue`).
// System-context writes (import, seed replay, migration) stay exempt, as does
// `readonlyWhen` on INSERT (a conditional lock needs a prior record).
//
// Proven here on the REAL showcase app over HTTP: `showcase_contact.lead_score`
// is the stand-in for the #3003 approval/status/amount columns — readonly,
// "computed by scoring rules — not user-editable", never on the create form.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

const OBJ = '/data/showcase_contact';
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;
const recordOf = (b: any) => b?.record ?? b?.data ?? b;

describe('showcase: static readonly write enforcement (#2948 / #3003 / #3043)', () => {
  let stack: VerifyStack;
  let token: string;
  let contactId: string;

  beforeAll(async () => {
    stack = await getSharedShowcase();
    await stack.signIn();
    token = await stack.signUp('ro-worker@verify.test');

    // #3043: a non-system INSERT that forges the readonly column is admitted
    // (HTTP 2xx, silent — like the UPDATE strip) but the forged value must NOT
    // persist. The create itself still succeeds — only the readonly key is
    // dropped from the payload, so the editable fields land.
    const created = await stack.apiAs(token, 'POST', OBJ, {
      name: 'Readonly Probe',
      email: 'ro-probe@verify.test',
      lead_score: 10, // forged: the UI never renders this on the create form
    });
    expect(created.status, 'create succeeds; the readonly key is dropped, not rejected').toBeLessThan(300);
    contactId = idOf(await created.json());
    expect(contactId).toBeTruthy();
  }, 60_000);

  it('INSERT forging the readonly field is silently stripped — the forged value never persists (#3043)', async () => {
    const res = await stack.apiAs(token, 'GET', `${OBJ}/${contactId}`);
    expect(res.status).toBe(200);
    const rec = recordOf(await res.json());
    expect(rec.name, 'editable field from the create payload landed').toBe('Readonly Probe');
    // No `defaultValue` is declared for `lead_score`, so the stripped field is
    // simply absent — the caller-forged 10 is gone.
    expect(rec.lead_score ?? null, 'insert-forged readonly value must NOT persist').toBeNull();
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
    expect(after.lead_score ?? null, 'forged readonly value must NOT persist').toBeNull();
    expect(after.notes, 'editable field from the same payload still lands').toBe(
      'legitimate edit in the same payload',
    );
  });

  it('a PATCH carrying ONLY the forged readonly field is a no-op on the record', async () => {
    const forge = await stack.apiAs(token, 'PATCH', `${OBJ}/${contactId}`, { lead_score: -1 });
    expect(forge.status).toBe(200);

    const after = recordOf(await (await stack.apiAs(token, 'GET', `${OBJ}/${contactId}`)).json());
    expect(after.lead_score ?? null, 'readonly value unchanged by an all-forged payload').toBeNull();
  });
});
