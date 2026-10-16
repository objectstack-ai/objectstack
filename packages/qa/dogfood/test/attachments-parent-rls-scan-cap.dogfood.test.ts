// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// attachments-storage.read-inherits-parent-rls — clause C3, the broad read
// past the old 2,000-row pre-scan window.
//
// [ADR-0139 E7] The read-visibility middleware used to pre-scan the candidate
// (parent_object, parent_id) pairs a query would touch, bounded at 2,000 rows,
// and fail CLOSED past that bound: the un-scanned rows were excluded, a warning
// said so, and the list's `total` agreed with the short answer. It now writes
// one `ReadableIds` leaf per parent object and pre-scans nothing for an
// ordinary parent: the engine composes the leaf from the security service's
// `canReadObject` and `getReadFilter`, and the driver evaluates it as one
// subquery. So the clause this file pins is now the OTHER side of the bound:
// a broad read past 2,000 candidates serves EVERY row the member may read,
// its `total` is true, no truncation is announced, and the security direction
// holds exactly as before — no invisible-parent row and no dangling-parent row.
// (The bounded probe survives for ADR-0139 D5's three classes only, which this
// fixture's parents are not; those are pinned in service-storage's
// `attachment-read-leaf.integration.test.ts`.)
//
// ## Why the seed is shaped the way it is
//
// The old pre-scan took 2,000 rows in whatever order the driver returned them,
// so the seed puts visible rows at BOTH ENDS of the insertion sequence with the
// filler bulk between them: any contiguous window from either end leaves one
// group outside it. The control asserts that premise (a 2,000-row window
// really does leave some visible row unscanned), so this pin cannot pass on a
// fixture the old bound would have served whole.
//
// Volume goes in through bulk system inserts: the clause is about the READ
// path, and 2000 real presigned uploads would pay for nothing it tests. The
// filler rows share ONE committed sys_file (ContentDocumentLink semantics — a
// file legitimately carries many join rows) and name parent ids that do not
// exist, which is what a hard-deleted parent record leaves behind.
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

/** The old pre-scan window (READ_SCAN_LIMIT in attachment-access-hooks.ts, now
 *  the bounded probe's, for ADR-0139 D5's classes only). Mirrored, not
 *  imported: the fixture must stay past the bound the gate shipped with. */
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

describe('[ADR-0139 E7] a broad sys_attachment read past the old pre-scan window is served whole', () => {
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

  it('control: the old window would be full and some visible row really is outside it', async () => {
    // The premise, asserted. A fixture the old 2,000-row window would have
    // served whole cannot tell the leaf from the bound, so if the seed ever
    // stopped crossing it this must fail loudly.
    const total = await ql.count('sys_attachment', { context: { ...SYS } });
    expect(total, 'candidate rows must exceed the old window').toBeGreaterThan(READ_SCAN_LIMIT);
    expect(visibleRows.size).toBe(VISIBLE_PER_GROUP * 2);

    const window = await ql.find('sys_attachment', {
      where: {},
      fields: ['id'],
      limit: READ_SCAN_LIMIT,
      context: { ...SYS },
    });
    expect(window.length, 'a 2,000-row window is full').toBe(READ_SCAN_LIMIT);
    const inWindow = new Set(window.map((r: any) => String(r.id)));
    const outside = [...visibleRows.keys()].filter((id) => !inWindow.has(id));
    expect(outside.length, 'at least one visible row falls outside a 2,000-row window').toBeGreaterThan(0);
  });

  it('C3 — the member is served every visible row, with a true total, and nothing is announced as truncated', async () => {
    const log = captureLog();
    let body: any;
    try {
      const res = await stack.apiAs(memberTok, 'GET', '/data/sys_attachment?$top=200');
      expect(res.status).toBe(200);
      body = await res.json();
    } finally {
      log.restore();
    }

    // 1. Every row the member may read, past the old window, on one page.
    const returned = new Set(body.records.map((r: any) => String(r.id)));
    const missing = [...visibleRows.keys()].filter((id) => !returned.has(id));
    expect(missing, 'no visible row is dropped').toEqual([]);
    expect(body.records.length, 'and nothing else is served').toBe(visibleRows.size);

    // 2. The total is the engine's count over the same WHERE, and it agrees.
    expect(body.total, 'total equals the rows served').toBe(visibleRows.size);

    // 3. No truncation: the bounded probe never ran for this parent.
    expect(log.matching('-row cap'), 'no pre-scan cap is announced').toEqual([]);
  });

  it('the security direction holds past the old window: no invisible-parent row, no dangling-parent row', async () => {
    const res = await stack.apiAs(memberTok, 'GET', '/data/sys_attachment?$top=200');
    expect(res.status).toBe(200);
    const records = ((await res.json()) as any).records as any[];
    expect(records.some((r) => String(r.id) === hiddenAttachmentId), 'an invisible parent’s row never appears').toBe(false);
    expect(records.filter((r) => r.parent_object === 'att_secret'), 'no att_secret row under any id').toEqual([]);
    expect(
      records.filter((r) => String(r.parent_id).startsWith('cap-ghost-')),
      'a row whose parent record does not exist is never served',
    ).toEqual([]);

    // The paired side: the record's owner is served the hidden row on the same read.
    const asAdmin = await stack.apiAs(adminTok, 'GET', '/data/sys_attachment?$top=200');
    const adminRecords = ((await asAdmin.json()) as any).records as any[];
    expect(adminRecords.some((r) => String(r.id) === hiddenAttachmentId), 'the owner reads it').toBe(true);
  });
});
