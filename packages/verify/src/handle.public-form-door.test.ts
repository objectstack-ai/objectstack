// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 4 — the anonymous public-form door, reached through a booted
 * stack.
 *
 * An app's web-to-lead / web-to-case branch runs on exactly one kind of write:
 * an anonymous public-form submission, `POST /api/v1/forms/:slug/submit`. That
 * route has ONE owner, `RestServer.registerFormEndpoints` in `@objectstack/rest`,
 * which `bootStack` mounts on the stack's Hono app. So on a booted stack the
 * door is `api('/forms/:slug/submit', …)` with no token, and it is the
 * platform's own route end to end: the slug resolution, the form's field
 * whitelist, the execution context it hands the engine, the `{ id }` answer.
 * The handle's in-process dispatcher (`flows.*`, `actions.run`) does not serve
 * it, and must not: a second implementation would be a copy of the route's
 * invariants that its owner never sees. A suite that rebuilds the door's
 * execution context by hand and calls the engine with it is that copy.
 *
 * What is pinned, each against what only the real door produces:
 *  - an anonymous submit succeeds, and the row lands;
 *  - the engine is handed the door's own execution context, exactly as the
 *    route builds it (`publicFormGrant` for the form's object, the
 *    `guest_portal` set, `anonymous`), read off the engine's own middleware
 *    seam rather than re-spelled;
 *  - the bound hook sees a guest (no session, no user), so an app's guest
 *    branch runs; a person's write through `hooks.run` is the control;
 *  - the record-change trigger fires the object's flow with no trigger user;
 *  - a key the form does not collect never reaches the engine;
 *  - refusals: an unknown slug, and a form that is not public, are answered
 *    `404 FORM_NOT_FOUND` and the engine is never handed a write.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack, defineView } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ObjectQL, OperationContext } from '@objectstack/objectql';

import { bootStack, type VerifyStack } from './harness.js';
import type { EngineRow } from './handle.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const REQUEST = 'pfd_request';
const LEDGER = 'pfd_ledger';
const ON_CREATE = 'pfd_request_created';
const PUBLIC_SLUG = 'pfd-intake';
const STAFF_SLUG = 'pfd-staff';

/** One dispatch the bound hook chain received, keyed by the submitted subject. */
interface HookSeen {
  event: string;
  subject: unknown;
  session: unknown;
  user: unknown;
  keys: string[];
}
const hookSaw: HookSeen[] = [];

/** One insert the engine was handed for the form's object: its context and payload keys. */
interface EngineSaw {
  subject: unknown;
  context: unknown;
  keys: string[];
}
const engineSaw: EngineSaw[] = [];

/** A copy taken when the engine is handed it; a value that cannot be copied is kept as is. */
function snapshot<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookCtx ={ event: string; input: Record<string, any>; session?: Record<string, any>; user?: { id?: string } };

/**
 * The app's guest branch, the shape a web-to-lead / web-to-case hook takes: a
 * write with no user and no system principal is a guest's, and the hook
 * stamps what a guest cannot send. It records what it saw first.
 */
const guestBranch = async (ctx: HookCtx) => {
  hookSaw.push({
    event: ctx.event,
    subject: ctx.input?.subject,
    session: ctx.session,
    user: ctx.user,
    keys: Object.keys(ctx.input ?? {}).sort(),
  });
  if (ctx.event === 'beforeInsert') {
    ctx.input.origin = !ctx.user?.id && ctx.session?.isSystem !== true ? 'web' : 'internal';
  }
};

const Request = ObjectSchema.create({
  name: REQUEST,
  label: 'Request',
  pluralLabel: 'Requests',
  sharingModel: 'private',
  fields: {
    subject: Field.text({ label: 'Subject', required: true }),
    email: Field.text({ label: 'Email' }),
    // Neither form collects these two: the hook stamps one, nobody may send the other.
    origin: Field.text({ label: 'Origin' }),
    status: Field.text({ label: 'Status' }),
  },
});

/** What the record-change flow writes: one row per run that reached its write. */
const Ledger = ObjectSchema.create({
  name: LEDGER,
  label: 'Ledger',
  pluralLabel: 'Ledgers',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    record_id: Field.text({ label: 'Record' }),
  },
});

const data = { provider: 'object' as const, object: REQUEST };
const RequestViews = defineView({
  list: { label: 'Requests', type: 'grid', data, columns: [{ field: 'subject' }] },
  formViews: {
    // Open to anonymous intake: enabled, anonymous, a public link.
    intake: {
      type: 'simple',
      data,
      sections: [
        { name: 'intake', label: 'Intake', columns: 1, fields: [{ field: 'subject', required: true }, { field: 'email' }] },
      ],
      sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${PUBLIC_SLUG}` },
    },
    // Shared, with a link, but NOT anonymous: not a public form.
    staff: {
      type: 'simple',
      data,
      sections: [{ name: 'staff', label: 'Staff', columns: 1, fields: [{ field: 'subject', required: true }] }],
      sharing: { enabled: true, allowAnonymous: false, publicLink: `/forms/${STAFF_SLUG}` },
    },
  },
});

/** start (record-after-create) → create_record(pfd_ledger) → end. */
const onCreate = {
  name: ON_CREATE,
  label: ON_CREATE,
  type: 'autolaunched',
  status: 'active',
  // The ledger is the flow's witness, written whoever (or nobody) triggered it.
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'On create', config: { objectName: REQUEST, triggerType: 'record-after-create' } },
    {
      id: 'write',
      type: 'create_record',
      label: 'Ledger',
      config: { objectName: LEDGER, fields: { name: ON_CREATE, record_id: { dialect: 'cel', source: 'record.id' } } },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write' },
    { id: 'e2', source: 'write', target: 'end' },
  ],
} as Flow;

const memberSet = PermissionSetSchema.parse({
  name: 'pfd_member_default',
  label: 'Public form door fixture member (default)',
  isDefault: true,
  objects: { [REQUEST]: { allowRead: true, allowCreate: true } },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.public-form-door',
    namespace: 'pfd',
    version: '0.0.0',
    type: 'app',
    name: 'Verify Public Form Door Fixture',
    description: 'One public form and one staff-only form on a request object, a guest-branch hook and a record-change flow.',
  },
  // ADR-0097: a record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [Request, Ledger],
  views: [RequestViews],
  hooks: [{ name: 'pfd_guest_branch', object: REQUEST, events: ['beforeInsert', 'afterInsert'], handler: guestBranch }],
  flows: [onCreate],
  permissions: [memberSet],
} as never);

let stack: VerifyStack;
let member: string;
let memberId: string;

beforeAll(async () => {
  stack = await bootStack(fixtureStack);
  // The first user is the seeded dev admin, so this sign-up is a plain member.
  member = await stack.signUp('pfd-member@verify.test');
  memberId = String((await stack.contextFor(member)).userId);
  // The engine's own extension seam, innermost: what each insert on the form's
  // object was handed, after every gate the boot registered has run.
  const ql = await stack.kernel.getServiceAsync<ObjectQL>('objectql');
  ql.registerMiddleware(
    async (op: OperationContext, next) => {
      if (op.operation === 'insert') {
        const row = (Array.isArray(op.data) ? op.data[0] : op.data) ?? {};
        engineSaw.push({ subject: row.subject, context: snapshot(op.context), keys: Object.keys(row).sort() });
      }
      await next();
    },
    { object: REQUEST },
  );
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop().catch(() => undefined);
});

/** Unique per call, so no assertion sees another test's rows. */
const uniq = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

/** The anonymous door: no token, the route's own path on the stack's HTTP surface. */
async function submit(slug: string, body: EngineRow): Promise<{ status: number; body: EngineRow }> {
  const res = await stack.api(`/forms/${slug}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const wire = await res.text();
  return { status: res.status, body: JSON.parse(wire) as EngineRow };
}

const hooksFor = (subject: string): HookSeen[] => hookSaw.filter((h) => h.subject === subject);
const engineFor = (subject: string): EngineSaw[] => engineSaw.filter((e) => e.subject === subject);

/** The engine's run log for the on-create flow, narrowed to runs `recordId` triggered. */
async function runsFor(recordId: string): Promise<Array<{ status: string; trigger: Record<string, unknown> }>> {
  const automation = stack.kernel.getService('automation') as {
    listRuns(name: string): Promise<Array<{ status: string; trigger?: Record<string, unknown> }>>;
  };
  return (await automation.listRuns(ON_CREATE))
    .filter((r) => r.trigger?.recordId === recordId)
    .map((r) => ({ status: r.status, trigger: r.trigger ?? {} }));
}

describe('item 4 — the anonymous public-form door on a booted stack', () => {
  it('an anonymous submit succeeds: 201 with the created id, and the row lands with what was submitted', async () => {
    const subject = uniq('anon');
    const res = await submit(PUBLIC_SLUG, { subject, email: 'guest@verify.test' });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(typeof res.body.id, 'the created id, at the top level').toBe('string');
    const [row] = await stack.rows(REQUEST, { id: res.body.id });
    expect(row).toMatchObject({ subject, email: 'guest@verify.test' });
  });

  it("the engine is handed the door's own execution context, exactly as the route builds it", async () => {
    const subject = uniq('ctx');
    const res = await submit(PUBLIC_SLUG, { subject });
    expect(res.status).toBe(201);

    const seen = engineFor(subject);
    expect(seen, 'one insert reached the engine').toHaveLength(1);
    // The route's context, whole: the form's one-object grant, the guest set,
    // anonymous. No user, no system principal, nothing else.
    expect(seen[0].context).toEqual({
      publicFormGrant: { object: REQUEST },
      permissions: ['guest_portal'],
      anonymous: true,
    });
  });

  it("the bound hook sees a guest, so the app's guest branch runs; a person's write is the control", async () => {
    const guestSubject = uniq('guest');
    const res = await submit(PUBLIC_SLUG, { subject: guestSubject });
    expect(res.status).toBe(201);

    const guest = hooksFor(guestSubject);
    expect(guest.map((h) => h.event)).toEqual(['beforeInsert', 'afterInsert']);
    for (const h of guest) {
      // No identity envelope reaches the hook: no session, no user.
      expect(h.session).toBeUndefined();
      expect(h.user).toBeUndefined();
    }
    expect((await stack.rows(REQUEST, { id: res.body.id }))[0].origin, 'the guest branch stamped the row').toBe('web');

    // Control that DISCRIMINATES: the same object written by a person through
    // the handle's write door reaches the same hook carrying that person.
    const personSubject = uniq('person');
    const written = await stack.hooks.run(REQUEST, 'insert', { subject: personSubject }, { as: member });
    const person = hooksFor(personSubject);
    expect(person.map((h) => h.event)).toEqual(['beforeInsert', 'afterInsert']);
    for (const h of person) expect(h.user).toMatchObject({ id: memberId });
    expect((await stack.rows(REQUEST, { id: written.id }))[0].origin).toBe('internal');
  });

  it('the record-change trigger fires the flow on an anonymous submit, with no trigger user', async () => {
    const res = await submit(PUBLIC_SLUG, { subject: uniq('flow') });
    expect(res.status).toBe(201);
    const id = res.body.id as string;

    const runs = await runsFor(id);
    expect(runs, 'the record-change trigger fired the flow').toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].trigger).toMatchObject({ type: 'record-after-create', object: REQUEST });
    expect(runs[0].trigger.userId, 'no trigger user').toBeUndefined();
    expect(await stack.rows(LEDGER, { record_id: id }), 'the flow reached its write').toHaveLength(1);

    // Control: a person's insert fires the same flow carrying that person.
    const written = await stack.hooks.run(REQUEST, 'insert', { subject: uniq('flow-person') }, { as: member });
    expect((await runsFor(String(written.id))).map((r) => r.trigger.userId)).toEqual([memberId]);
  });

  it('a key the form does not collect never reaches the engine', async () => {
    const subject = uniq('extra');
    const res = await submit(PUBLIC_SLUG, { subject, email: 'guest@verify.test', status: 'forged' });
    expect(res.status).toBe(201);

    expect(engineFor(subject).map((e) => e.keys), 'the payload the engine was handed').toEqual([['email', 'subject']]);
    const before = hooksFor(subject).find((h) => h.event === 'beforeInsert');
    expect(before?.keys, 'what the hook saw').not.toContain('status');
    expect((await stack.rows(REQUEST, { id: res.body.id }))[0].status).toBeNull();
  });

  describe('refusals: answered by the route, and the engine is never handed a write', () => {
    it('an unknown slug', async () => {
      const subject = uniq('unknown');
      const res = await submit('pfd-no-such-form', { subject });
      expect({ status: res.status, code: res.body.code }).toEqual({ status: 404, code: 'FORM_NOT_FOUND' });
      expect(engineFor(subject)).toEqual([]);
      expect(hooksFor(subject)).toEqual([]);
      expect(await stack.rows(REQUEST, { subject })).toEqual([]);
    });

    it('a form that is shared but not anonymous', async () => {
      const subject = uniq('staff');
      const res = await submit(STAFF_SLUG, { subject });
      expect({ status: res.status, code: res.body.code }).toEqual({ status: 404, code: 'FORM_NOT_FOUND' });
      expect(engineFor(subject)).toEqual([]);
      expect(hooksFor(subject)).toEqual([]);
      expect(await stack.rows(REQUEST, { subject })).toEqual([]);
    });
  });
});
