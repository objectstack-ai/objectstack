// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0120, amendment of 2026-11-01 under the business-requirement matrix's
// S10] The cross-organization half of
// `create-caller-id-collision.dogfood.test.ts`, on a walled two-organization
// boot (`isolated` and `group`).
//
// The record `id` is the one deployment-global key, on every posture. A create
// in organization B that names the `id` of a row organization A holds collides
// on that key: it answers `409 UNIQUE_VIOLATION`, writes nothing, names no
// organization or owner, and answers EXACTLY what B's create naming the id of
// B's own row answers. The existence signal that leaves is accepted and
// recorded in the ADR (ruling record 5934879010, rule 2, extended to every
// create door), bounded by id unguessability rather than by the refusal's
// shape. What is pinned is the identity of the two answers and the untouched
// row; a refusal that differed, or named the other organization, is a defect
// against that record.
//
// The fixture object is `public_read_write` so that the wall is the ONLY thing
// hiding A's row from B. The wall itself is measured, not assumed: the
// precondition case reads A's row from B (404) and from the platform operator
// (present), because a boot that walled nothing would make the identity below
// a comparison of two visible rows.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const OBJECT = 'cid_record';
const SYS = { isSystem: true } as const;
const idOf = (b: any) => b?.id ?? b?.record?.id;
/** A fresh id the shape the SQL driver mints (16 characters, base64url). */
const freshId = () => randomBytes(12).toString('base64url');

const CidRecord = ObjectSchema.create({
  name: OBJECT,
  label: 'CID Record',
  pluralLabel: 'CID Records',
  // [ADR-0090 D1] Open within an organization, so the organization wall is the
  // one thing that hides another organization's row.
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

/** The app's default profile: every member may read and create the one object. */
const cidMember = {
  name: 'cid_member',
  label: 'CID member',
  isDefault: true,
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true } },
};

const cidStack = defineStack({
  manifest: {
    id: 'com.dogfood.create-caller-id',
    namespace: 'cid',
    version: '0.0.0',
    type: 'app',
    name: 'Create caller id fixture',
    description: 'One open object and a default profile, for the create-with-a-held-id pin under a walled posture.',
  },
  objects: [CidRecord],
  permissions: [cidMember],
});

interface Answer {
  status: number;
  text: string;
  body: any;
}

async function answer(res: Response): Promise<Answer> {
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, text, body };
}

/** One create, carrying `id`, through each of the three doors. */
const DOORS: Record<string, (stack: VerifyStack, token: string, id: string, name: string) => Promise<Answer>> = {
  'POST /data/:object': async (stack, token, id, name) =>
    answer(await stack.apiAs(token, 'POST', `/data/${OBJECT}`, { id, name })),
  'POST /data/:object/batch (create)': async (stack, token, id, name) =>
    answer(await stack.apiAs(token, 'POST', `/data/${OBJECT}/batch`, { operation: 'create', records: [{ data: { id, name } }] })),
  'POST /batch (cross-object)': async (stack, token, id, name) =>
    answer(await stack.apiAs(token, 'POST', '/batch', { operations: [{ object: OBJECT, action: 'create', data: { id, name } }] })),
};

/** The refusal's code, wherever the door carries it. */
function refusalCode(door: string, a: Answer): unknown {
  return door.startsWith('POST /data/:object/batch') ? a.body?.results?.[0]?.errors?.[0]?.code : a.body?.code;
}

for (const posture of ['isolated', 'group'] as const) {
  describe(`${posture}: a create naming another organization's id answers what naming one's own answers (ADR-0120 S10 amendment)`, () => {
    let stack: VerifyStack;
    let ql: any;
    let operatorToken: string;
    let tokA: string;
    let tokB: string;
    let orgA: string;
    let orgB: string;
    let userA: string;
    let userB: string;
    const emailA = `cid-a-${posture}@wall.test`;
    const emailB = `cid-b-${posture}@wall.test`;
    const slugA = `cid-a-${posture}`;
    const slugB = `cid-b-${posture}`;
    /** Organization A's row: behind the wall for B. */
    let foreignId: string;
    /** Organization B's own row: visible to B. */
    let ownId: string;
    const previous = process.env.OS_TENANCY_POSTURE;

    const rowOf = async (id: string) => ql.findOne(OBJECT, { where: { id }, context: SYS });

    beforeAll(async () => {
      process.env.OS_TENANCY_POSTURE = posture;
      stack = await bootStack(cidStack as never, { multiTenant: 'posture-only' });
      ql = await stack.kernel.getServiceAsync('objectql');
      operatorToken = await stack.signIn();
      tokA = await stack.signUp(emailA);
      tokB = await stack.signUp(emailB);
      for (const [tok, slug] of [[tokA, slugA], [tokB, slugB]] as const) {
        const created = await stack.apiAs(tok, 'POST', '/auth/organization/create', { name: slug, slug });
        expect(created.status, await created.clone().text()).toBe(200);
        const id = ((await created.json()) as { id: string }).id;
        if (tok === tokA) orgA = id; else orgB = id;
        const active = await stack.apiAs(tok, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
        expect(active.status, await active.clone().text()).toBe(200);
      }
      const uid = async (email: string) => String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id);
      userA = await uid(emailA);
      userB = await uid(emailB);

      const a = await stack.apiAs(tokA, 'POST', `/data/${OBJECT}`, { name: 'cid row in A' });
      expect(a.status, await a.clone().text()).toBe(201);
      foreignId = idOf(await a.json());
      const b = await stack.apiAs(tokB, 'POST', `/data/${OBJECT}`, { name: 'cid row in B' });
      expect(b.status, await b.clone().text()).toBe(201);
      ownId = idOf(await b.json());
    }, 180_000);

    afterAll(async () => {
      await stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('PRECONDITION: a real walled posture, two organizations, and A\'s row behind the wall for B', async () => {
      const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
      expect(orgA).toBeTruthy();
      expect(orgB).toBeTruthy();
      expect(orgA).not.toBe(orgB);
      expect((await rowOf(foreignId))?.organization_id).toBe(orgA);
      expect((await rowOf(ownId))?.organization_id).toBe(orgB);

      const fromB = await stack.apiAs(tokB, 'GET', `/data/${OBJECT}/${foreignId}`);
      expect(fromB.status, 'B cannot read A\'s row').toBe(404);
      const ownFromB = await stack.apiAs(tokB, 'GET', `/data/${OBJECT}/${ownId}`);
      expect(ownFromB.status, 'B reads its own row').toBe(200);
      const fromA = await stack.apiAs(tokA, 'GET', `/data/${OBJECT}/${foreignId}`);
      expect(fromA.status, 'A reads its own row').toBe(200);
    });

    for (const [door, create] of Object.entries(DOORS)) {
      describe(door, () => {
        it('CONTROL: a fresh caller-supplied id is honoured, in the caller\'s organization', async () => {
          const id = freshId();
          const a = await create(stack, tokB, id, 'cid fresh');
          expect(a.status, a.text).toBeLessThan(300);
          const row = await rowOf(id);
          expect(row?.id, 'the row landed under the caller-supplied id').toBe(id);
          expect(row?.organization_id).toBe(orgB);
        });

        it('the cross-organization collision answers exactly what the own-row collision answers, and writes nothing', async () => {
          const foreignBefore = JSON.stringify(await rowOf(foreignId));
          const ownBefore = JSON.stringify(await rowOf(ownId));

          const onOwn = await create(stack, tokB, ownId, 'cid collide own');
          const onForeign = await create(stack, tokB, foreignId, 'cid collide foreign');

          expect(refusalCode(door, onOwn), onOwn.text).toBe('UNIQUE_VIOLATION');
          if (door === 'POST /data/:object/batch (create)') {
            expect(onOwn.body?.results?.[0]?.errors?.[0]?.httpStatus).toBe(409);
            expect(onOwn.body?.succeeded).toBe(0);
          } else {
            expect(onOwn.status).toBe(409);
          }
          expect(onForeign.status, 'same status').toBe(onOwn.status);
          expect(onForeign.body, 'same body, whole').toEqual(onOwn.body);

          expect(JSON.stringify(await rowOf(foreignId)), 'A\'s row is byte-identical after').toBe(foreignBefore);
          expect(JSON.stringify(await rowOf(ownId)), 'B\'s row is byte-identical after').toBe(ownBefore);
        });

        it('the refusal names no organization and no owner', async () => {
          const onForeign = await create(stack, tokB, foreignId, 'cid collide foreign');
          for (const named of [orgA, orgB, slugA, slugB, userA, userB, emailA, emailB]) {
            expect(named, 'a value to look for').toBeTruthy();
            expect(onForeign.text).not.toContain(named);
          }
          for (const key of ['owner_id', 'organization_id', 'owner', 'organization']) {
            expect(onForeign.text).not.toContain(`"${key}"`);
          }
        });
      });
    }
  });
}
