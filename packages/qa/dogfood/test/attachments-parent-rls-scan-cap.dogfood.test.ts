// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// attachments-storage.read-inherits-parent-rls — clause C3, the 2000-row
// pre-scan cap.
//
// The read-visibility middleware pre-scans the candidate (parent_object,
// parent_id) pairs a query would touch, bounded at READ_SCAN_LIMIT = 2000.
// Past that bound the filter is built from a TRUNCATED candidate set, and the
// clause is about which way the truncation falls: rows outside the scan window
// are EXCLUDED (the caller may lose rows they could see) rather than admitted
// unfiltered (the caller gains rows they may not). The cap also logs, because a
// silent truncation is indistinguishable from a leak — the item's own wording:
// "silence plus leaked rows is the failure".
//
// ## Why the seed is shaped the way it is
//
// The pre-scan takes 2000 rows in whatever order the driver returns them, with
// no ORDER BY of its own — so which rows land inside the window is NOT a
// property this test may assume. A first attempt seeded the probe row last and
// asserted it fell outside; measured, it fell INSIDE (the control caught it),
// so the driver is not returning insertion order here.
//
// The seed therefore puts visible rows at BOTH ENDS of the insertion sequence
// with the filler bulk between them. Any ordering that takes a contiguous run
// from either end leaves one of the two groups outside the window, so some
// visible row is excluded either way — and the test then picks an actually
// excluded row at RUNTIME rather than predicting which one it will be. The
// control asserts that premise (window full, at least one visible parent
// unscanned) instead of trusting it.
//
// Volume goes in through bulk system inserts: the clause is about the READ
// path, and 2000 real presigned uploads would pay for nothing it tests. The
// filler rows share ONE committed sys_file (ContentDocumentLink semantics — a
// file legitimately carries many join rows).
//
// @proof: attachments-parent-rls-scan-cap

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import {
  bootAttachmentsHarness,
  stopAttachmentsHarness,
  uploadFile,
  FILE_BYTES,
  type AttachmentsHarness,
} from './fixtures/attachments-authz-harness.js';

const SYS = { isSystem: true } as const;

/** READ_SCAN_LIMIT in attachment-access-hooks.ts. Mirrored, not imported: the
 *  test asserts the SHIPPED bound, so a silent change to it must surface here
 *  as a failure rather than be followed automatically. */
const READ_SCAN_LIMIT = 2_000;

/** Visible attachments seeded BEFORE the filler bulk, and again AFTER it. */
const VISIBLE_PER_GROUP = 40;
/** Filler rows between them — enough that the two groups cannot both fit. */
const FILLER = 2_400;

function captureLog() {
  const lines: string[] = [];
  const sink = (chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  };
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(sink as never);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(sink as never);
  return {
    matching: (needle: string) => lines.filter((l) => l.includes(needle)),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

describe('sys_attachment read visibility fails CLOSED past the pre-scan cap (#9483)', () => {
  let harness: AttachmentsHarness;
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string, memberTok: string;
  let adminId: string;
  let sharedFile: string;
  let secretId: string;
  /** attachment id -> its (visible) parent id, for all 2 x VISIBLE_PER_GROUP. */
  const visibleRows = new Map<string, string>();
  let hiddenAttachmentId: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  /** Bulk-seed N visible att_case parents, one attachment each. */
  const seedVisibleGroup = async (tag: string, n: number) => {
    const parents = Array.from({ length: n }, (_u, i) => ({ name: `${tag}-parent-${i}` }));
    const created = await ql.insertMany('att_case', parents, { context: { ...SYS } });
    const parentIds = created.map((r: any) => String(r.id ?? r.record?.id));
    expect(parentIds.filter(Boolean).length, `${tag} parents created`).toBe(n);

    const rows = parentIds.map((pid: string) => ({
      parent_object: 'att_case',
      parent_id: pid,
      file_id: sharedFile,
      file_name: 'visible.txt',
      mime_type: 'text/plain',
      size: FILE_BYTES.length,
    }));
    const made = await ql.insertMany('sys_attachment', rows, { context: { ...SYS } });
    made.forEach((r: any, i: number) => {
      const id = String(r.id ?? r.record?.id);
      if (id && id !== 'undefined') visibleRows.set(id, parentIds[i]);
    });
  };

  beforeAll(async () => {
    harness = await bootAttachmentsHarness();
    stack = harness.stack;
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('att-cap-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');

    sharedFile = await uploadFile(stack, adminTok, 'shared.txt');

    const secret = await ql.insert(
      'att_secret',
      { name: 'cap secret', owner_id: adminId },
      { context: { ...SYS } },
    );
    secretId = secret.id;

    // Group A — visible, seeded FIRST.
    await seedVisibleGroup('capA', VISIBLE_PER_GROUP);

    // Filler — dangling parent ids, which is what a hard-deleted parent record
    // leaves behind. They can widen nobody's visibility; they only consume the
    // scan window.
    const filler = Array.from({ length: FILLER }, (_u, i) => ({
      parent_object: 'att_case',
      parent_id: `cap-ghost-${i}`,
      file_id: sharedFile,
      file_name: 'shared.txt',
      mime_type: 'text/plain',
      size: FILE_BYTES.length,
    }));
    for (let i = 0; i < filler.length; i += 400) {
      await ql.insertMany('sys_attachment', filler.slice(i, i + 400), { context: { ...SYS } });
    }

    // The invisible-parent row, and Group B — visible, seeded LAST.
    const hidden = await ql.insert(
      'sys_attachment',
      {
        parent_object: 'att_secret',
        parent_id: secretId,
        file_id: sharedFile,
        file_name: 'secret.txt',
        mime_type: 'text/plain',
        size: FILE_BYTES.length,
      },
      { context: { ...SYS } },
    );
    hiddenAttachmentId = String(hidden.id);
    await seedVisibleGroup('capB', VISIBLE_PER_GROUP);
  }, 600_000);

  afterAll(async () => {
    await stopAttachmentsHarness(harness);
  });

  it('control: the window is full and some visible parent really is outside it', async () => {
    // The premise, asserted. An unreached branch reads exactly like a satisfied
    // one, so if the seed ever stopped crossing the bound this must fail loudly
    // rather than let the clause pass on a code path it never entered.
    const total = await ql.count('sys_attachment', { context: { ...SYS } });
    expect(total, 'candidate rows must exceed READ_SCAN_LIMIT').toBeGreaterThan(READ_SCAN_LIMIT);
    expect(visibleRows.size).toBe(VISIBLE_PER_GROUP * 2);

    const scanned = await ql.find('sys_attachment', {
      where: {},
      fields: ['id'],
      limit: READ_SCAN_LIMIT,
      context: { ...SYS },
    });
    expect(scanned.length, 'the pre-scan window is exactly the cap').toBe(READ_SCAN_LIMIT);

    const scannedIds = new Set(scanned.map((r: any) => String(r.id)));
    const unscannedVisible = [...visibleRows.keys()].filter((id) => !scannedIds.has(id));
    expect(
      unscannedVisible.length,
      'at least one visible row must fall outside the window, or the clause is unreachable',
    ).toBeGreaterThan(0);
  });

  it('C3 — the capped broad read warns AND fails closed: visible rows are dropped, the hidden one never appears', async () => {
    const log = captureLog();
    let body: any;
    try {
      const res = await stack.apiAs(memberTok, 'GET', '/data/sys_attachment?$top=200');
      expect(res.status).toBe(200);
      body = await res.json();
    } finally {
      log.restore();
    }

    // 1. The truncation is LOUD. This is the clause's own oracle: silence plus
    //    leaked rows is the failure, so the warning is what makes a truncated
    //    answer distinguishable from a complete one.
    const warned = log.matching('[storage] attachment read visibility');
    expect(warned.length, 'the cap must announce itself').toBeGreaterThan(0);
    expect(
      warned.some((l) => l.includes(`${READ_SCAN_LIMIT}-row cap`) && l.includes('fail-closed')),
      'the warning names the cap and the direction it falls',
    ).toBe(true);

    // 2. It falls CLOSED: rows the member could otherwise see are excluded,
    //    rather than the un-scanned remainder being admitted unfiltered.
    const returned = new Set(body.records.map((r: any) => String(r.id)));
    const returnedVisible = [...visibleRows.keys()].filter((id) => returned.has(id));
    expect(
      returnedVisible.length,
      'a truncated scan must return FEWER visible rows than exist, not more',
    ).toBeLessThan(visibleRows.size);

    // 3. And the security direction, which must hold under truncation too.
    expect(returned.has(hiddenAttachmentId), 'an invisible parent’s row must never appear').toBe(
      false,
    );
    expect(
      body.records.every((r: any) => r.parent_object !== 'att_secret'),
      'no att_secret row under any id',
    ).toBe(true);

    // 4. Every row that DID come back is one the member may genuinely see —
    //    truncation must not admit a dangling-parent row either.
    expect(
      body.records.every((r: any) => visibleRows.has(String(r.id))),
      'no row with an unresolvable parent is admitted by the truncated filter',
    ).toBe(true);
  });

  it('the dropped rows are genuinely visible: a scoped read returns one the broad read omitted', async () => {
    // The contrast that makes assertion 2 above mean "excluded by the cap"
    // rather than "invisible anyway". Without it, a surface that hid these rows
    // from this member for some entirely different reason would satisfy the
    // fail-closed assertion while proving nothing about the cap.
    const broad = await stack.apiAs(memberTok, 'GET', '/data/sys_attachment?$top=200');
    const returned = new Set(((await broad.json()) as any).records.map((r: any) => String(r.id)));
    const dropped = [...visibleRows.entries()].find(([id]) => !returned.has(id));
    expect(dropped, 'the broad read dropped at least one visible row').toBeTruthy();

    const [droppedId, parentId] = dropped as [string, string];
    const scoped = await stack.apiAs(
      memberTok,
      'GET',
      `/data/sys_attachment?$top=10&parent_object=att_case&parent_id=${parentId}`,
    );
    expect(scoped.status).toBe(200);
    const rows = ((await scoped.json()) as any).records;
    expect(
      rows.some((r: any) => String(r.id) === droppedId),
      'the same row, reachable when the read does not hit the cap',
    ).toBe(true);
  });
});
