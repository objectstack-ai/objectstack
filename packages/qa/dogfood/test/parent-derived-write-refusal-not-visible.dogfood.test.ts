// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21755] A write refusal on a parent-derived join row (`sys_attachment`,
// `sys_comment`) names nothing to a caller who cannot read the row's parent —
// measured at the REST data door, the wire answer the unit seam cannot show.
//
// ── the class ─────────────────────────────────────────────────────────────
//
// Both rows inherit their visibility from a PARENT record: the read door
// answers "not found" for a row whose parent the caller cannot read. Their
// write gates (service-storage's attachment gate, plugin-audit's comment gate)
// refuse a non-uploader / non-author who cannot edit the parent with a NAMED
// refusal — one that carries the parent record's object and id. For a caller
// who can read the parent that is honest; for one who cannot, the write door
// named what the read door hides.
//
// The platform's by-id write pre-image check refuses such a write BEFORE the
// gate for every principal its row filter binds (an `org_member`, under the
// shipped ownership floor), with its not-visible refusal, which names nothing.
// The principals it does not bind — a session outside the floor's domain —
// reached the gate's named refusal instead. The cure is the ruled one: the
// gate answers those principals the pre-image check's own refusal.
//
// ── what is pinned ────────────────────────────────────────────────────────
//
//   1. ⭐ The SAME answer, not a lookalike: the outside-the-domain caller's
//      delete and update refusal is compared field by field with the answer
//      the pre-image check gives an `org_member` for the same write, measured
//      on an org-bound boot of the same stack. Status, code, sentence and
//      envelope all equal.
//   2. No parent identity anywhere in the response body — neither the
//      parent's object nor its id.
//   3. A caller who CAN read the parent but may not edit it still gets the
//      gate's named refusal (`ATTACHMENT_DELETE_DENIED` / the comment gate's
//      `RECORD_NOT_ACCESSIBLE`): that caller already sees the parent.
//   4. Who may write is unchanged — every refused write leaves the row in
//      place.
//
// ── the arming is the pin ─────────────────────────────────────────────────
//
// Each boot proves its principal's domain before anything is measured. The
// outside-the-domain caller must NOT hold `org_member` (holding it, the
// pre-image check answers first and pin 1 passes without the gate ever being
// asked), and the reference caller MUST hold it (or the "reference" is the
// gate's own answer compared with itself). Both must hold the delete grants,
// or every cell measures an RBAC refusal instead.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineStack } from '@objectstack/spec';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import {
  AttSecret,
  AttReadonly,
  attFixtureBaselineSet,
  attachmentManagerSet,
} from './fixtures/attachments-fixture.js';
import { CmtPrivate, CmtReadonly, commentManagerSet } from './fixtures/comments-fixture.js';
import { armedWhen, assertArmed, principalArmed, resolveAuthzFor } from './armed.js';

const SYS = { isSystem: true } as const;

/** Both parent-derived join objects, private and read-only parents for each. */
const stackDefinition = defineStack({
  manifest: {
    id: 'com.dogfood.parent-derived-write-refusal',
    version: '0.0.0',
    type: 'app',
    name: 'Parent-derived write refusal fixture',
    description:
      'Private and read-only parents for sys_attachment and sys_comment: the write refusal a caller who cannot read the parent receives.',
  },
  objects: [AttSecret, AttReadonly, CmtPrivate, CmtReadonly],
});

function security(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [
      ...securityDefaultPermissionSets,
      attFixtureBaselineSet,
      attachmentManagerSet,
      commentManagerSet,
    ],
    fallbackPermissionSet: attFixtureBaselineSet.name,
  });
}

const GRANTS = [attachmentManagerSet.name, commentManagerSet.name];

interface Booted {
  stack: VerifyStack;
  rootDir: string;
  ql: any;
  adminId: string;
  /** The measured principal, holding both delete grants. */
  token: string;
}

async function boot(orgContext: boolean, email: string): Promise<Booted> {
  const rootDir = mkdtempSync(join(tmpdir(), 'parent-refusal-'));
  const stack = await bootStack(stackDefinition as never, {
    orgContext,
    security: security(),
    extraPlugins: [
      new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      new AuditPlugin(),
    ],
  });
  await stack.signIn();
  const token = await stack.signUp(email);
  const ql = await stack.kernel.getServiceAsync<any>('objectql');
  const adminId = (await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }))?.id;
  const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
  for (const name of GRANTS) {
    const set = await ql.findOne('sys_permission_set', { where: { name }, context: SYS });
    expect(set?.id, `fixture permission set ${name} seeded`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: set.id }, { context: { ...SYS } });
  }
  return { stack, rootDir, ql, adminId, token };
}

/** One attachment and one comment on a parent only the admin can read, and
 * one of each on a parent everyone reads but only the admin edits. Neither is
 * the measured caller's: the uploader / author is the admin. */
async function seed(b: Booted) {
  const secret = await b.ql.insert('att_secret', { name: 'hidden parent', owner_id: b.adminId }, { context: { ...SYS } });
  const readonly = await b.ql.insert('att_readonly', { name: 'read-only parent', owner_id: b.adminId }, { context: { ...SYS } });
  const cmtSecret = await b.ql.insert('cmt_private', { name: 'hidden thread parent', owner_id: b.adminId }, { context: { ...SYS } });
  const cmtReadonly = await b.ql.insert('cmt_readonly', { name: 'read-only thread parent', owner_id: b.adminId }, { context: { ...SYS } });
  const attachment = (parentObject: string, parentId: string) =>
    b.ql.insert(
      'sys_attachment',
      {
        parent_object: parentObject,
        parent_id: parentId,
        file_id: `f_${parentId}`,
        file_name: 'a.txt',
        mime_type: 'text/plain',
        size: 1,
        uploaded_by: b.adminId,
      },
      { context: { ...SYS } },
    );
  const comment = (threadObject: string, parentId: string) =>
    b.ql.insert(
      'sys_comment',
      { thread_id: `${threadObject}:${parentId}`, body: 'the admin wrote this', author_id: b.adminId },
      { context: { ...SYS } },
    );
  return {
    hiddenAttachment: { row: await attachment('att_secret', secret.id), parent: ['att_secret', String(secret.id)] },
    readableAttachment: { row: await attachment('att_readonly', readonly.id) },
    hiddenComment: { row: await comment('cmt_private', cmtSecret.id), parent: ['cmt_private', String(cmtSecret.id)] },
    readableComment: { row: await comment('cmt_readonly', cmtReadonly.id) },
  };
}

/** Status plus parsed body, with the raw text kept for substring checks. */
async function answer(res: Response): Promise<{ status: number; body: any; text: string }> {
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

describe('parent-derived write refusal on an unreadable parent names nothing', () => {
  let outside: Booted;
  let inside: Booted;
  let outsideRows: Seeded;
  let insideRows: Seeded;

  beforeAll(async () => {
    outside = await boot(false, 'refusal-outside@verify.test');
    inside = await boot(true, 'refusal-inside@verify.test');

    await assertArmed([
      armedWhen({
        control:
          "a principal OUTSIDE the ownership floor's domain — the class the by-id write pre-image check does not " +
          'bind, so the attachment and comment gates answer it themselves',
        disarmedBy:
          'an org-bound boot of this half: the principal then holds org_member, the pre-image check refuses ' +
          'first, and the outside-the-domain pins pass without either gate being asked',
        observe: () => resolveAuthzFor(outside.stack, outside.token),
        armed: (ctx) => !ctx.positions.includes('org_member') && GRANTS.every((g) => ctx.permissions.includes(g)),
        describe: (ctx) => `positions=${JSON.stringify(ctx.positions)} permissions=${JSON.stringify(ctx.permissions)}`,
      }),
      principalArmed({
        stack: inside.stack,
        token: inside.token,
        who: 'the reference org_member',
        positions: ['org_member'],
        permissions: GRANTS,
        control: "the by-id write pre-image check's not-visible refusal — the reference answer pin 1 compares with",
        disarmedBy:
          'an org-less boot of the reference half: no org_member, so the "reference" is the gate answering ' +
          'itself and pin 1 compares a refusal with its own copy',
      }),
    ]);

    outsideRows = await seed(outside);
    insideRows = await seed(inside);
  }, 180_000);

  afterAll(async () => {
    for (const b of [outside, inside]) {
      await b?.stack?.stop();
      if (b?.rootDir) await fs.rm(b.rootDir, { recursive: true, force: true });
    }
  });

  const cases = [
    { label: 'attachment', object: 'sys_attachment', key: 'hiddenAttachment', patch: { description: 'rewritten' } },
    { label: 'comment', object: 'sys_comment', key: 'hiddenComment', patch: { body: 'rewritten' } },
  ] as const;

  for (const c of cases) {
    for (const verb of ['DELETE', 'PATCH'] as const) {
      it(`${c.label} ${verb}: the outside-the-domain caller gets the pre-image check's not-visible refusal, naming nothing`, async () => {
        const mine = outsideRows[c.key];
        const ref = insideRows[c.key];
        const payload = verb === 'PATCH' ? c.patch : undefined;

        // The precondition, read off the read door: this caller cannot see the row.
        expect((await outside.stack.apiAs(outside.token, 'GET', `/data/${c.object}/${mine.row.id}`)).status).toBe(404);

        const got = await answer(await outside.stack.apiAs(outside.token, verb, `/data/${c.object}/${mine.row.id}`, payload));
        const reference = await answer(await inside.stack.apiAs(inside.token, verb, `/data/${c.object}/${ref.row.id}`, payload));

        // Pin 1 — the reference really is the pre-image check's refusal…
        expect(reference.status, reference.text).toBe(403);
        expect(reference.body.code).toBe('PERMISSION_DENIED');
        // …and the outside caller's answer is the same answer, field by field.
        expect(got.status, got.text).toBe(reference.status);
        expect(got.body).toEqual(reference.body);

        // Pin 2 — no parent identity anywhere in the body.
        const [parentObject, parentId] = mine.parent;
        expect(got.text).not.toContain(parentObject);
        expect(got.text).not.toContain(parentId);

        // Pin 4 — refused means untouched.
        const after = await outside.ql.findOne(c.object, { where: { id: mine.row.id }, context: SYS });
        expect(after, 'the refused write left the row in place').toBeTruthy();
        if (verb === 'PATCH') {
          for (const [k, v] of Object.entries(c.patch)) expect(after[k]).not.toBe(v);
        }
      });
    }
  }

  it("attachment: a caller who can READ the parent but not edit it keeps the gate's named refusal", async () => {
    const { row } = outsideRows.readableAttachment;
    expect((await outside.stack.apiAs(outside.token, 'GET', `/data/sys_attachment/${row.id}`)).status).toBe(200);
    const got = await answer(await outside.stack.apiAs(outside.token, 'DELETE', `/data/sys_attachment/${row.id}`));
    expect(got.status, got.text).toBe(403);
    expect(got.body.code).toBe('ATTACHMENT_DELETE_DENIED');
    expect(got.body.object).toBe('att_readonly');
    expect(await outside.ql.findOne('sys_attachment', { where: { id: row.id }, context: SYS })).toBeTruthy();
  });

  it("comment: a caller who can READ the parent but not edit it keeps the gate's named refusal", async () => {
    const { row } = outsideRows.readableComment;
    expect((await outside.stack.apiAs(outside.token, 'GET', `/data/sys_comment/${row.id}`)).status).toBe(200);
    const got = await answer(await outside.stack.apiAs(outside.token, 'DELETE', `/data/sys_comment/${row.id}`));
    expect(got.status, got.text).toBe(403);
    expect(got.body.code).toBe('RECORD_NOT_ACCESSIBLE');
    expect(got.body.object).toBe('cmt_readonly');
    expect(await outside.ql.findOne('sys_comment', { where: { id: row.id }, context: SYS })).toBeTruthy();
  });
});
