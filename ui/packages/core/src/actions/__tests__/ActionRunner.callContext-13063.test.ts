// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13063 — `ActionRunner.execute(action, callContext)` runs one
 * dispatch against a record other than the page's, without touching the
 * runner's own context.
 *
 * A related-list row on a record page is a record of the CHILD object, while
 * the runner's context names the page. The related-list bridge hands the row
 * here as `{ record, objectName }`. The runner-side half pinned here: the
 * merge, that it is one-shot, that the handlers are shared, and the two keys
 * that follow the merge (`ctx`, and the `objectFields` / `objectActions` pair).
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionContext, type ActionDef } from '../ActionRunner';

const PAGE: ActionContext = {
  record: { id: 'P-1', name: 'Launch' },
  objectName: 'project',
  objectFields: { name: { type: 'text' } },
  objectActions: [{ name: 'close_project' }],
  user: { id: 'u1' },
};
const ROW = { id: 't1', name: 'Write spec' };

describe('execute with a call context (objectui#13063)', () => {
  it('a form action runs against the call context and the base context is untouched', async () => {
    const runner = new ActionRunner(PAGE);
    const nav = vi.fn();
    runner.setNavigationHandler(nav);

    await runner.execute({ type: 'form', target: 'task.edit' }, { record: ROW, objectName: 'task' });
    expect(nav).toHaveBeenLastCalledWith('/forms/task.edit?recordId=t1&recordObject=task', { external: false });

    // Control: without it, the page context decides, as before.
    await runner.execute({ type: 'form', target: 'task.edit' });
    expect(nav).toHaveBeenLastCalledWith('/forms/task.edit', { external: false });
    expect(runner.getContext().record).toEqual(PAGE.record);
    expect(runner.getContext().objectName).toBe('project');
  });

  it('a registered handler receives the merged context; user and the identity alias stay', async () => {
    const runner = new ActionRunner(PAGE);
    const handler = vi.fn(async (_action: ActionDef, _ctx?: ActionContext) => ({ success: true }));
    runner.registerHandler('api', handler);

    await runner.execute({ type: 'api', target: '/x' }, { record: ROW, objectName: 'task' });
    const ctx = handler.mock.calls[0][1] as ActionContext;
    expect(ctx.record).toEqual(ROW);
    expect(ctx.objectName).toBe('task');
    expect(ctx.user).toEqual({ id: 'u1' });
    expect(ctx.os?.user).toEqual({ id: 'u1' });
  });

  it('another object drops the base object definitions; the same object keeps them', async () => {
    const runner = new ActionRunner(PAGE);
    const handler = vi.fn(async (_action: ActionDef, _ctx?: ActionContext) => ({ success: true }));
    runner.registerHandler('api', handler);

    await runner.execute({ type: 'api', target: '/x' }, { record: ROW, objectName: 'task' });
    const other = handler.mock.calls[0][1] as ActionContext;
    expect('objectFields' in other).toBe(false);
    expect('objectActions' in other).toBe(false);

    await runner.execute({ type: 'api', target: '/x' }, { record: { id: 'P-2' }, objectName: 'project' });
    const same = handler.mock.calls[1][1] as ActionContext;
    expect(same.objectFields).toEqual(PAGE.objectFields);
    expect(same.objectActions).toEqual(PAGE.objectActions);
  });

  it('the `ctx` mirror follows the merge', async () => {
    const runner = new ActionRunner({ ...PAGE, ctx: { ...PAGE } });
    const handler = vi.fn(async (_action: ActionDef, _ctx?: ActionContext) => ({ success: true }));
    runner.registerHandler('api', handler);

    await runner.execute({ type: 'api', target: '/x' }, { record: ROW, objectName: 'task' });
    const ctx = handler.mock.calls[0][1] as ActionContext;
    expect(ctx.ctx.record).toEqual(ROW);
    expect(ctx.ctx.objectName).toBe('task');
    expect('objectFields' in ctx.ctx).toBe(false);
  });

  it('the confirm handler is shared and reads the row', async () => {
    const runner = new ActionRunner(PAGE);
    const confirm = vi.fn(async () => false);
    runner.setConfirmHandler(confirm);

    const result = await runner.execute(
      { type: 'form', target: 'task.edit', confirmText: 'Log time on ${record.name}?' },
      { record: ROW, objectName: 'task' },
    );
    expect(result.success).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Log time on Write spec?');
  });
});
