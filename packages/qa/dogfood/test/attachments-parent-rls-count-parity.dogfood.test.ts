// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// attachments-storage.read-inherits-parent-rls — clause C1, plus the
// resolution-failure half of C3.
//
// QA run #9401 scored this item PARTIAL: the pinned matrix proves the ROWS of a
// restricted member's `sys_attachment` list exclude invisible parents, and stops
// there. C1 is the COUNT — and a count leak is a real RLS leak: `total` comes
// from `engine.count()`, NOT from the find path, which is precisely why the
// visibility rule is a data MIDDLEWARE (find/findOne/count/aggregate) and not a
// find hook. A suite that only reads `records` cannot see the difference, and
// would stay green with `count()` unfiltered — leaking the true row count of
// records the caller may not read.
//
// ## The trap this pin had to step around
//
// `total` is only computed by `engine.count()` when the request carries a PAGE
// LIMIT. Without one, `protocol.findData` sets `total = records.length` — so a
// list issued with no `$top` reports a `total` that is *trivially* consistent
// with its rows, and an assertion on it proves nothing at all: it stays green
// with the count path fully unfiltered, because the count path never runs.
// Every REST assertion below therefore passes `$top`, and asserts a `total`
// STRICTLY GREATER than the rows returned, so the count call is proven to have
// happened rather than assumed.
//
// @proof: attachments-parent-rls-count-parity

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import { resolveAuthzContext } from '@objectstack/core';
import {
  bootAttachmentsHarness,
  stopAttachmentsHarness,
  uploadFile,
  FILE_BYTES,
  type AttachmentsHarness,
} from './fixtures/attachments-authz-harness.js';

const SYS = { isSystem: true } as const;

/** Attachments on the parent the restricted member CAN read. */
const VISIBLE_COUNT = 4;
/** Attachments on the admin-owned private parent they CANNOT read. */
const HIDDEN_COUNT = 3;
/** Page size — small enough that `total` must exceed the rows on the page. */
const PAGE = 2;

describe('sys_attachment reads inherit parent RLS — the COUNT too (#9483)', () => {
  let harness: AttachmentsHarness;
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string, memberTok: string;
  let adminId: string;
  let caseId: string;
  let secretId: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  /** The SAME authz context the REST entry point resolves — real positions and
   *  permission sets off the live tables, never a hand-built principal. */
  const authzFor = async (token: string) => {
    const authService: any = await stack.kernel.getServiceAsync('auth');
    let api: any = authService?.api;
    if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
    const headers = new Headers({ authorization: `Bearer ${token}` });
    return resolveAuthzContext({
      ql,
      headers,
      getSession: async (h: any) => api?.getSession?.({ headers: h }),
    });
  };

  /** Attach through the REAL route as admin (who can edit both parents). */
  const attach = async (parentObject: string, parentId: string) => {
    const fileId = await uploadFile(stack, adminTok);
    const res = await stack.apiAs(adminTok, 'POST', '/data/sys_attachment', {
      parent_object: parentObject,
      parent_id: parentId,
      file_id: fileId,
      file_name: 'hello.txt',
      mime_type: 'text/plain',
      size: FILE_BYTES.length,
    });
    expect(res.status, `attach to ${parentObject}`).toBeLessThan(300);
    return fileId;
  };

  const listAs = async (token: string, query: string) => {
    const res = await stack.apiAs(token, 'GET', `/data/sys_attachment${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as { records: any[]; total: number };
  };

  beforeAll(async () => {
    harness = await bootAttachmentsHarness();
    stack = harness.stack;
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('att-count-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');

    // Visible parent: att_case is public_read_write — every member reads it.
    const caseRes = await stack.apiAs(adminTok, 'POST', '/data/att_case', { name: 'visible case' });
    expect(caseRes.status).toBeLessThan(300);
    const caseBody = (await caseRes.json()) as any; // a Response body reads ONCE
    caseId = String(caseBody.id ?? caseBody.record?.id ?? caseBody.data?.id);

    // Invisible parent: att_secret defaults to PRIVATE and is owner-anchored to
    // admin, so a fresh member can neither read nor edit it.
    const secret = await ql.insert(
      'att_secret',
      { name: 'count secret', owner_id: adminId },
      { context: { ...SYS } },
    );
    secretId = secret.id;

    for (let i = 0; i < VISIBLE_COUNT; i++) await attach('att_case', caseId);
    for (let i = 0; i < HIDDEN_COUNT; i++) await attach('att_secret', secretId);
  }, 180_000);

  afterAll(async () => {
    await stopAttachmentsHarness(harness);
  });

  it('control: the seed is what the assertions below assume, and the parents split as intended', async () => {
    const all = await ql.count('sys_attachment', { context: { ...SYS } });
    expect(all, 'total rows actually seeded').toBe(VISIBLE_COUNT + HIDDEN_COUNT);

    // The premise every count assertion rests on. If a future fixture change
    // made att_secret readable, the leak assertions would pass for the wrong
    // reason — so the invisibility is asserted, not assumed.
    const readsCase = await stack.apiAs(memberTok, 'GET', `/data/att_case/${caseId}`);
    expect(readsCase.status, 'the member CAN read the visible parent').toBe(200);
    const readsSecret = await stack.apiAs(memberTok, 'GET', `/data/att_secret/${secretId}`);
    expect([403, 404], 'and CANNOT read the private one').toContain(readsSecret.status);
  });

  it('C1 — the restricted member’s list `total` counts only visible-parent rows', async () => {
    const body = await listAs(memberTok, `?$top=${PAGE}`);

    // The count path is PROVEN to have run: with a page of 2 and 4 visible
    // rows, `total` can only exceed `records.length` if `engine.count()`
    // answered it. (Were the count skipped, total would be 2 and this fails.)
    expect(body.records.length, 'one page').toBe(PAGE);
    expect(body.total, 'total came from engine.count(), not the page').toBeGreaterThan(
      body.records.length,
    );

    // The clause itself: the count is filtered IDENTICALLY to the rows.
    expect(body.total, 'total must exclude every invisible-parent row').toBe(VISIBLE_COUNT);
    expect(body.total, 'and must not be the raw table count').not.toBe(
      VISIBLE_COUNT + HIDDEN_COUNT,
    );
  });

  it('C1 — the entitled caller’s total on the same request INCLUDES them (the paired side)', async () => {
    // Without this pair the assertion above is satisfied by a surface that
    // counts nothing for anybody — a filter that always denies is not a filter.
    const body = await listAs(adminTok, `?$top=${PAGE}`);
    expect(body.records.length).toBe(PAGE);
    expect(body.total, 'admin reads both parents').toBe(VISIBLE_COUNT + HIDDEN_COUNT);
  });

  it('C1 — rows and count agree: paging the member all the way through yields exactly `total`', async () => {
    // Rows-vs-count parity stated as one assertion rather than two numbers that
    // happen to match: enumerate everything the member can actually reach and
    // check the reported total against it. A count filtered by a DIFFERENT
    // predicate than the rows fails here even when both are non-zero.
    const seen = new Set<string>();
    for (let offset = 0; offset < 50; offset += PAGE) {
      const page = await listAs(memberTok, `?$top=${PAGE}&$skip=${offset}`);
      if (!page.records.length) break;
      for (const r of page.records) seen.add(String(r.id));
    }
    const reported = (await listAs(memberTok, `?$top=${PAGE}`)).total;
    expect(seen.size, 'rows the member can actually enumerate').toBe(VISIBLE_COUNT);
    expect(reported, 'and the total it is told').toBe(seen.size);
  });

  it('C1 — engine.count() under the member’s own resolved context is filtered too', async () => {
    // The wire `total` is one consumer of `engine.count()`. This drives the
    // middleware's `count` op directly, with the context the REST layer would
    // have built, so the pin is on the middleware rather than on one route's
    // arithmetic.
    const memberCtx = await authzFor(memberTok);
    const memberCount = await ql.count('sys_attachment', { context: memberCtx });
    const systemCount = await ql.count('sys_attachment', { context: { ...SYS } });

    expect(memberCount).toBe(VISIBLE_COUNT);
    expect(systemCount).toBe(VISIBLE_COUNT + HIDDEN_COUNT);
    expect(memberCount, 'the member is told strictly less than the table holds').toBeLessThan(
      systemCount,
    );
  });

  it('C1 — a count NARROWED to the invisible parent answers zero, not the true number', async () => {
    // The sharpest shape of the leak: the caller already knows the parent id and
    // is asking only "how many". Rows come back empty either way; only the count
    // distinguishes a filtered surface from one that answers the raw table.
    const memberCtx = await authzFor(memberTok);
    const scoped = await ql.count('sys_attachment', {
      where: { parent_object: 'att_secret', parent_id: secretId },
      context: memberCtx,
    });
    expect(scoped).toBe(0);

    const asAdmin = await ql.count('sys_attachment', {
      where: { parent_object: 'att_secret', parent_id: secretId },
      context: await authzFor(adminTok),
    });
    expect(asAdmin, 'the same question, answered for someone entitled to it').toBe(HIDDEN_COUNT);
  });

  it('C3 (resolution-failure half) — a row whose parent RECORD no longer resolves is EXCLUDED, not leaked', async () => {
    // `computeParentVisibilityFilter` resolves the visible id subset per
    // parent_object through the CALLER's context; ids that come back with
    // nothing simply never enter the `$in`, so their rows drop out of the
    // filter. Fail-closed is the whole point: the alternative reading — "could
    // not decide, so allow" — is the leak. A dangling parent_id is not exotic;
    // a hard-deleted parent record leaves exactly this behind.
    //
    // NOTE on what this does NOT reach. The sibling branch — an unknown
    // parent_OBJECT, caught by `catch { visible = [] }` — cannot be provoked
    // from this lane at all: the #2727 `enable.files` gate refuses to create a
    // sys_attachment row against an object that is not files-enabled, even
    // under system context (measured: `File attachments are not enabled for
    // object 'att_ghost_object'`). So the unknown-object arm has no reachable
    // fixture here, and the ref says so rather than implying it is covered.
    const before = await ql.count('sys_attachment', { context: { ...SYS } });
    await ql.insert(
      'sys_attachment',
      {
        parent_object: 'att_case',
        parent_id: 'no-such-case-record',
        file_id: await uploadFile(stack, adminTok),
        file_name: 'dangling.txt',
        mime_type: 'text/plain',
        size: FILE_BYTES.length,
      },
      { context: { ...SYS } },
    );
    expect(await ql.count('sys_attachment', { context: { ...SYS } })).toBe(before + 1);

    const memberCtx = await authzFor(memberTok);
    const body = await listAs(memberTok, `?$top=50`);
    expect(
      body.records.some((r: any) => String(r.parent_id) === 'no-such-case-record'),
      'a parent that resolves to nothing must not admit its row',
    ).toBe(false);
    expect(body.total, 'and must not be counted either').toBe(VISIBLE_COUNT);
    expect(await ql.count('sys_attachment', { context: memberCtx })).toBe(VISIBLE_COUNT);
  });
});
