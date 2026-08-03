// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { installAttachmentAccessHooks, type AttachmentSharingLike } from './attachment-access-hooks.js';
import type { AttachmentLifecycleEngine } from './attachment-lifecycle.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/** Capture the two registered hooks so tests can drive them directly. */
function install(opts: {
  attachments?: Array<Record<string, unknown>>;
  sharing?: AttachmentSharingLike | null;
}) {
  const hooks = new Map<string, (ctx: any) => Promise<void>>();
  const engine: AttachmentLifecycleEngine = {
    registerHook: (event, handler) => {
      hooks.set(event, handler as any);
    },
    find: async (_object, options: any) => {
      const rows = (opts.attachments ?? []).filter((r) =>
        Object.entries(options?.where ?? {}).every(([k, v]) => r[k] === v),
      );
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    findOne: async (_object, options: any) =>
      (opts.attachments ?? []).find((r) =>
        Object.entries(options?.where ?? {}).every(([k, v]) => r[k] === v),
      ) ?? null,
    update: async () => ({}),
  };
  installAttachmentAccessHooks(engine, () => opts.sharing, silentLogger());
  return {
    beforeInsert: hooks.get('beforeInsert')!,
    beforeDelete: hooks.get('beforeDelete')!,
  };
}

/** Caller-scoped api fake: `visibleParents` is the set of records the
 * caller can read, keyed `object/id`. */
function apiFor(visibleParents: string[]) {
  return {
    object: (name: string) => ({
      findOne: async ({ where }: any) =>
        visibleParents.includes(`${name}/${where.id}`) ? { id: where.id } : null,
    }),
  };
}

const insertCtx = (data: any, opts: { userId?: string; isSystem?: boolean; visible?: string[] } = {}) => ({
  object: 'sys_attachment',
  event: 'beforeInsert',
  input: { data, options: { context: { userId: opts.userId, permissions: [] } } },
  session: opts.isSystem ? { isSystem: true, userId: opts.userId } : opts.userId ? { userId: opts.userId } : undefined,
  api: apiFor(opts.visible ?? []),
});

const deleteCtx = (input: any, opts: { userId?: string; isSystem?: boolean; visible?: string[] } = {}) => ({
  object: 'sys_attachment',
  event: 'beforeDelete',
  input: { ...input, options: { ...(input.options ?? {}), context: { userId: opts.userId, permissions: [] } } },
  session: opts.isSystem ? { isSystem: true, userId: opts.userId } : opts.userId ? { userId: opts.userId } : undefined,
  api: apiFor(opts.visible ?? []),
});

describe('attachment access — beforeInsert (parent visibility + provenance)', () => {
  it('rejects attaching to a parent the caller cannot read (403 ATTACHMENT_PARENT_ACCESS)', async () => {
    const { beforeInsert } = install({});
    const ctx = insertCtx(
      { parent_object: 'att_secret', parent_id: 'r1', file_id: 'f1' },
      { userId: 'u1', visible: [] },
    );
    await expect(beforeInsert(ctx)).rejects.toMatchObject({
      code: 'ATTACHMENT_PARENT_ACCESS',
      status: 403,
      object: 'att_secret',
    });
  });

  it('allows attaching to a readable parent', async () => {
    const { beforeInsert } = install({});
    const ctx = insertCtx(
      { parent_object: 'att_case', parent_id: 'r1', file_id: 'f1' },
      { userId: 'u1', visible: ['att_case/r1'] },
    );
    await expect(beforeInsert(ctx)).resolves.toBeUndefined();
  });

  it('server-stamps uploaded_by from the session, overwriting a spoofed value', async () => {
    const { beforeInsert } = install({});
    const data = { parent_object: 'att_case', parent_id: 'r1', file_id: 'f1', uploaded_by: 'someone-else' };
    await beforeInsert(insertCtx(data, { userId: 'u1', visible: ['att_case/r1'] }));
    expect(data.uploaded_by).toBe('u1');
  });

  it('bypasses for system context and context-less calls', async () => {
    const { beforeInsert } = install({});
    await expect(
      beforeInsert(insertCtx({ parent_object: 'x', parent_id: 'r' }, { isSystem: true, userId: 'u1' })),
    ).resolves.toBeUndefined();
    await expect(beforeInsert(insertCtx({ parent_object: 'x', parent_id: 'r' }, {}))).resolves.toBeUndefined();
  });

  // #3712 — a schedule-triggered flow run has provenance but no caller. This
  // gate reads `!ctx.session` as "no identity envelope was supplied", so write
  // provenance is deliberately kept OUT of the session: had such a run
  // presented an empty session instead, this bypass would have silently become
  // a 403 and narrowed the #1888 fail-open for attachments alone.
  it('still bypasses a flow run that carries provenance but no session', async () => {
    const { beforeInsert } = install({ sharing: { canEdit: async () => false } });
    await expect(
      beforeInsert({
        ...insertCtx({ parent_object: 'x', parent_id: 'r' }, {}),
        provenance: { flowRunId: 'run_1' },
      }),
    ).resolves.toBeUndefined();
  });

  // #2970 item 3 — with a sharing service present, attach requires EDIT
  // (canEdit), not merely read visibility.
  it('with sharing: rejects attaching when the caller cannot EDIT the parent (even if readable)', async () => {
    const canEdit = vi.fn(async () => false);
    const { beforeInsert } = install({ sharing: { canEdit } });
    const ctx = insertCtx(
      { parent_object: 'att_readonly', parent_id: 'r1', file_id: 'f1' },
      { userId: 'u1', visible: ['att_readonly/r1'] }, // readable, but canEdit=false
    );
    await expect(beforeInsert(ctx)).rejects.toMatchObject({
      code: 'ATTACHMENT_PARENT_ACCESS',
      status: 403,
    });
    expect(canEdit).toHaveBeenCalledWith('att_readonly', 'r1', expect.objectContaining({ userId: 'u1' }));
  });

  it('with sharing: allows attaching when the caller CAN edit the parent', async () => {
    const { beforeInsert } = install({ sharing: { canEdit: async () => true } });
    const ctx = insertCtx(
      { parent_object: 'att_case', parent_id: 'r1', file_id: 'f1' },
      { userId: 'u1', visible: [] }, // not readable via api, but canEdit=true governs
    );
    await expect(beforeInsert(ctx)).resolves.toBeUndefined();
  });
});

describe('attachment access — beforeDelete (uploader or parent editor)', () => {
  const row = { id: 'a1', file_id: 'f1', parent_object: 'att_secret', parent_id: 'r1', uploaded_by: 'uploader' };

  it('the uploader may always delete their attachment', async () => {
    const canEdit = vi.fn(async () => false);
    const { beforeDelete } = install({ attachments: [row], sharing: { canEdit } });
    await expect(beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'uploader' }))).resolves.toBeUndefined();
    expect(canEdit).not.toHaveBeenCalled();
  });

  it('a non-uploader without parent edit is rejected (403 ATTACHMENT_DELETE_DENIED)', async () => {
    const { beforeDelete } = install({ attachments: [row], sharing: { canEdit: async () => false } });
    await expect(beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'stranger' }))).rejects.toMatchObject({
      code: 'ATTACHMENT_DELETE_DENIED',
      status: 403,
    });
  });

  it('a parent editor may delete another user\'s attachment', async () => {
    const canEdit = vi.fn(async (object: string, recordId: string, ctx: any) => {
      expect(object).toBe('att_secret');
      expect(recordId).toBe('r1');
      expect(ctx.userId).toBe('editor');
      return true;
    });
    const { beforeDelete } = install({ attachments: [row], sharing: { canEdit } });
    await expect(beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'editor' }))).resolves.toBeUndefined();
  });

  it('multi-delete requires EVERY matched row to pass', async () => {
    const rows = [
      { ...row, id: 'a1', uploaded_by: 'me' },
      { ...row, id: 'a2', uploaded_by: 'someone-else', parent_object: 'att_secret', parent_id: 'r2' },
    ];
    const { beforeDelete } = install({ attachments: rows, sharing: { canEdit: async () => false } });
    await expect(
      beforeDelete(deleteCtx({ options: { where: { parent_object: 'att_secret' }, multi: true } }, { userId: 'me' })),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED' });
  });

  it('degrades to parent READ visibility when the sharing service is absent', async () => {
    const { beforeDelete } = install({ attachments: [row], sharing: null });
    // caller can read the parent → allowed
    await expect(
      beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'reader', visible: ['att_secret/r1'] })),
    ).resolves.toBeUndefined();
    // caller cannot read the parent → denied
    await expect(
      beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'reader', visible: [] })),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED' });
  });

  it('bypasses for system context; a no-match delete is not blocked', async () => {
    const { beforeDelete } = install({ attachments: [row], sharing: { canEdit: async () => false } });
    await expect(beforeDelete(deleteCtx({ id: 'a1' }, { isSystem: true, userId: 'x' }))).resolves.toBeUndefined();
    await expect(beforeDelete(deleteCtx({ id: 'missing' }, { userId: 'x' }))).resolves.toBeUndefined();
  });

  // #4757 — no id AND no `where` is not "nothing matched", it is "nothing was
  // ever queried": the engine seeds `{ object }` as the delete AST and hands
  // it to `driver.deleteMany`, which empties the table. The gate must refuse
  // rather than fall through the empty-`rows` short-circuit.
  describe('unscoped multi-delete (no id, no where) — #4757', () => {
    const unscopedShapes: Array<[string, any]> = [
      ['options.multi with no where', { options: { multi: true } }],
      ['no id and no options at all', {}],
      ['an explicitly null where', { options: { multi: true, where: null } }],
      ['an explicitly undefined where', { options: { multi: true, where: undefined } }],
    ];

    for (const [label, input] of unscopedShapes) {
      it(`refuses ${label} (403 ATTACHMENT_DELETE_DENIED)`, async () => {
        const { beforeDelete } = install({ attachments: [row], sharing: { canEdit: async () => true } });
        await expect(beforeDelete(deleteCtx(input, { userId: 'uploader' }))).rejects.toMatchObject({
          code: 'ATTACHMENT_DELETE_DENIED',
          status: 403,
        });
      });
    }

    it('refuses even the uploader of every matched row — the AST is unscoped, not row-scoped', async () => {
      // The uploader shortcut is per RESOLVED row; with nothing resolved there
      // is no row whose ownership could license emptying the table.
      const canEdit = vi.fn(async () => true);
      const { beforeDelete } = install({
        attachments: [{ ...row, uploaded_by: 'uploader' }],
        sharing: { canEdit },
      });
      await expect(
        beforeDelete(deleteCtx({ options: { multi: true } }, { userId: 'uploader' })),
      ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED' });
      expect(canEdit).not.toHaveBeenCalled();
    });

    it('still bypasses for system context and context-less calls', async () => {
      const { beforeDelete } = install({ attachments: [row], sharing: { canEdit: async () => false } });
      await expect(
        beforeDelete(deleteCtx({ options: { multi: true } }, { isSystem: true, userId: 'x' })),
      ).resolves.toBeUndefined();
      await expect(beforeDelete(deleteCtx({ options: { multi: true } }, {}))).resolves.toBeUndefined();
    });

    // The scoped paths must be untouched by the fix: an id-bound delete and a
    // `where`-bound one still authorize row-by-row and still ALLOW when they
    // pass. `where: {}` matches every row but is a real query — every matched
    // row is authorized, so it stays on the authorize path, not the refuse one.
    it('leaves the legitimate scoped paths alone', async () => {
      const { beforeDelete } = install({ attachments: [row], sharing: { canEdit: async () => true } });
      await expect(beforeDelete(deleteCtx({ id: 'a1' }, { userId: 'stranger' }))).resolves.toBeUndefined();
      await expect(
        beforeDelete(
          deleteCtx({ options: { where: { parent_object: 'att_secret' }, multi: true } }, { userId: 'stranger' }),
        ),
      ).resolves.toBeUndefined();
      await expect(
        beforeDelete(deleteCtx({ options: { where: {}, multi: true } }, { userId: 'stranger' })),
      ).resolves.toBeUndefined();
    });

    it('an empty `where` still authorizes every matched row (one failing row denies)', async () => {
      const { beforeDelete } = install({ attachments: [row], sharing: { canEdit: async () => false } });
      await expect(
        beforeDelete(deleteCtx({ options: { where: {}, multi: true } }, { userId: 'stranger' })),
      ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED' });
    });
  });
});
