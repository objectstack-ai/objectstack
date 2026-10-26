// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4292 — the PRODUCER half: an id never travels without its object.
 *
 * `executeForm` forwards the record an action fired from as
 * `/forms/:name?recordId=<id>`. That URL says nothing about WHICH object the id
 * belongs to, so the consumer resolves it against the FormView's own target —
 * correct whenever the action fired from a record of that object, and nothing
 * checked that it had. `target: 'showcase_task.edit'` on an Account record
 * header is publishable metadata, and with per-table integer keys
 * `GET /data/showcase_task/42` answers happily for the user who was on Account
 * 42. Since #4278 taught the route to honour the param, that stopped being a
 * duplicate INSERT and became a targeted UPDATE of another object's record.
 *
 * PM ruling pinned here (issue #4292, on the claim comment): an id must never
 * travel without its object identity, and a mismatch fails closed at BOTH ends.
 * For this end: forward `?recordId=` only when the firing context record's
 * object matches the target view's object (the `<object>.<view>` prefix),
 * forward NO id on a mismatch so create semantics are preserved, and forward the
 * object identity alongside the id when it IS forwarded, as the consumer's
 * defence-in-depth input.
 *
 * ## Where the object identity comes from — measured, not invented
 *
 * `context.objectName`, which is this repo's existing spelling of the fact:
 * `ActionProvider` documents the flat trio (`record`, `user`, `objectName`) and
 * mirrors it into `ctx.*`; `useConsoleActionRuntime` seeds it for every console
 * surface that fires record actions; `recordFormNavigation`'s resolver already
 * reads that same key. `action.objectName` is NOT consulted — it describes the
 * action's placement, not the record the id came from.
 *
 * ## Reverse verification — predicted directions, fix reverted
 *
 * Restoring the unconditional `recordId != null ? … : base` line turns RED:
 *
 *   - "a cross-object target forwards NO record id"  → `?recordId=42` appended
 *   - "forwards the object alongside the id"          → `recordObject` absent
 *   - "…through the navigation handler too"           → same, on the handler arg
 *   - "encodes an object name"                        → param absent entirely
 *
 * GREEN BOTH SIDES, on purpose (controls — this card must not move them):
 *
 *   - "a host that publishes no objectName is unchanged" — the pre-#4292
 *     contract for every host that cannot answer the question. Tightening on
 *     absent information would turn working edit flows into creates;
 *   - "no record id at all ⇒ bare form route";
 *   - "an unqualified target name is not comparable".
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionContext } from '../ActionRunner';

/** The "log time" shape: fired from a Task, targeting a Task form view. */
const TASK_CONTEXT: ActionContext = {
  record: { id: 42, title: 'Write the report' },
  objectName: 'showcase_task',
  user: { id: 'u1' },
};

/**
 * The defect's shape: the user is on an ACCOUNT record, the action targets a
 * TASK form view, and both objects number their rows from 1 — so `42` names a
 * real row in each.
 */
const ACCOUNT_CONTEXT: ActionContext = {
  record: { id: 42, name: 'Acme Corp' },
  objectName: 'showcase_account',
  user: { id: 'u1' },
};

describe('same object ⇒ forward the id AND its object (#4292)', () => {
  it('forwards the object alongside the id', async () => {
    const runner = new ActionRunner(TASK_CONTEXT);
    const result = await runner.execute({ type: 'form', target: 'showcase_task.edit' });

    expect(result.success).toBe(true);
    // RED before the fix: `?recordId=42` with no object — the id travelling
    // alone is the defect itself.
    expect(result.redirect).toBe(
      '/forms/showcase_task.edit?recordId=42&recordObject=showcase_task',
    );
  });

  it('does the same through the navigation handler', async () => {
    const runner = new ActionRunner(TASK_CONTEXT);
    const navHandler = vi.fn();
    runner.setNavigationHandler(navHandler);
    await runner.execute({ type: 'form', target: 'showcase_task.edit' });

    expect(navHandler).toHaveBeenCalledWith(
      '/forms/showcase_task.edit?recordId=42&recordObject=showcase_task',
      expect.objectContaining({ external: false }),
    );
  });

  it('reads the id from `data` when there is no `record`, same as before', async () => {
    const runner = new ActionRunner({
      data: { id: 7 },
      objectName: 'showcase_task',
    } as ActionContext);
    const result = await runner.execute({ type: 'form', target: 'showcase_task.edit' });

    expect(result.redirect).toBe('/forms/showcase_task.edit?recordId=7&recordObject=showcase_task');
  });

  /**
   * Both values are percent-encoded, so an id carrying `/` or `#` cannot break
   * the query string apart or smuggle a second param in. `URLSearchParams`
   * decodes them on the consumer side — pinned end-to-end in the console's
   * `FormPage.test.ts`.
   */
  it('encodes the values it appends', async () => {
    const runner = new ActionRunner({
      record: { id: 'a/b#c' },
      objectName: 'showcase_task',
    } as ActionContext);
    const result = await runner.execute({ type: 'form', target: 'showcase_task.edit' });

    expect(result.redirect).toBe(
      `/forms/showcase_task.edit?recordId=${encodeURIComponent('a/b#c')}` +
        '&recordObject=showcase_task',
    );
  });
});

describe('cross-object ⇒ forward NO id, preserving create semantics (#4292)', () => {
  /**
   * The card's own collision scenario. Pre-#4278 this shape produced an empty
   * form and an INSERT — which for a "log time on this account" action pointed
   * at a Task create view is the CORRECT outcome, not a bug. So the fix
   * restores it rather than refusing: a create launched from a record is a
   * legitimate shape, and only the id is wrong to carry across the boundary.
   */
  it('a cross-object target forwards NO record id', async () => {
    const runner = new ActionRunner(ACCOUNT_CONTEXT);
    const result = await runner.execute({ type: 'form', target: 'showcase_task.edit' });

    expect(result.success).toBe(true);
    // RED before the fix: `/forms/showcase_task.edit?recordId=42`, which the
    // consumer then resolves as Task 42 — a different record entirely.
    expect(result.redirect).toBe('/forms/showcase_task.edit');
    expect(result.redirect).not.toContain('recordId');
    expect(result.redirect).not.toContain('recordObject');
  });

  it('withholds it through the navigation handler too', async () => {
    const runner = new ActionRunner(ACCOUNT_CONTEXT);
    const navHandler = vi.fn();
    runner.setNavigationHandler(navHandler);
    await runner.execute({ type: 'form', target: 'showcase_task.edit' });

    expect(navHandler).toHaveBeenCalledWith(
      '/forms/showcase_task.edit',
      expect.objectContaining({ external: false }),
    );
  });

  /**
   * Prefix matching is on the WHOLE object segment, so an object whose name is
   * a string-prefix of another's does not read as a match.
   */
  it('does not mistake a name-prefix for the same object', async () => {
    const runner = new ActionRunner({
      record: { id: 42 },
      objectName: 'showcase_task',
    } as ActionContext);
    const result = await runner.execute({ type: 'form', target: 'showcase_task_archive.edit' });

    expect(result.redirect).toBe('/forms/showcase_task_archive.edit');
  });
});

/**
 * CONTROLS — green before and after. The guard fires only on information it
 * actually has; everything else keeps the pre-#4292 contract byte for byte.
 */
describe('control: not comparable ⇒ unchanged behaviour', () => {
  it('a host that publishes no objectName still gets the plain id', async () => {
    // Exactly the context `ActionRunner.test.ts` has always used.
    const runner = new ActionRunner({
      data: { id: 1, name: 'Test' },
      record: { id: 1, status: 'active' },
      user: { id: 'u1', role: 'admin' },
    } as ActionContext);
    const result = await runner.execute({ type: 'form', target: 'showcase_task.default' });

    expect(result.redirect).toBe('/forms/showcase_task.default?recordId=1');
  });

  it('treats a blank objectName as absent rather than as a mismatch', async () => {
    for (const objectName of ['', '   ']) {
      const runner = new ActionRunner({ record: { id: 1 }, objectName } as ActionContext);
      const result = await runner.execute({ type: 'form', target: 'showcase_task.default' });
      expect(result.redirect).toBe('/forms/showcase_task.default?recordId=1');
    }
  });

  it('an unqualified target name names no object, so nothing is compared', async () => {
    const runner = new ActionRunner(ACCOUNT_CONTEXT);
    const result = await runner.execute({ type: 'form', target: 'quick_intake' });

    // The id still travels — plus the identity, which is what lets the
    // consumer make the call this runner cannot.
    expect(result.redirect).toBe(
      '/forms/quick_intake?recordId=42&recordObject=showcase_account',
    );
  });

  it('no record id at all ⇒ bare form route', async () => {
    const runner = new ActionRunner({ objectName: 'showcase_task', user: { id: 'u1' } });
    const result = await runner.execute({ type: 'form', target: 'showcase_task.edit' });

    expect(result.redirect).toBe('/forms/showcase_task.edit');
  });

  it('still errors when no form target is given', async () => {
    const runner = new ActionRunner(TASK_CONTEXT);
    const result = await runner.execute({ type: 'form' } as never);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/form target/i);
  });
});

/**
 * The action's OWN `objectName` is a statement about where the action is
 * declared, not about the record the id was read from. Trusting it to describe
 * the record is the conflation that made this defect possible, so it must not
 * be able to talk the runner into forwarding across a boundary.
 */
describe('action.objectName cannot stand in for the context record (#4292)', () => {
  it('is ignored: the context record still decides', async () => {
    const runner = new ActionRunner(ACCOUNT_CONTEXT);
    const result = await runner.execute({
      type: 'form',
      target: 'showcase_task.edit',
      objectName: 'showcase_task',
    });

    expect(result.redirect).toBe('/forms/showcase_task.edit');
  });
});
