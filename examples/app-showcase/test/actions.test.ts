// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { actionBodyRunnerFactory, QuickJSScriptRunner } from '@objectstack/runtime';

import * as pages from '../src/ui/pages/index.js';
import { allActions, MarkDoneAction, NewTaskAction, PortfolioSnapshotAction } from '../src/ui/actions/index.js';

/**
 * Execution-path coverage for declared actions.
 *
 * The `coverage.test.ts` check only asserts that every `ActionType` *appears*
 * in the bundle — a `type: 'script'` action with no executable handler passes
 * it. That blind spot shipped the #2169 bug: `showcase_mark_done` declared
 * `type: 'script'` but carried neither a `body` nor a `target`, so AppPlugin
 * registered no engine handler and clicking "Mark Done" failed at runtime with
 * `Action 'showcase_mark_done' on object '*' not found`.
 *
 * These tests drive the **real** runtime path — `actionBodyRunnerFactory` +
 * the QuickJS sandbox, the exact bridge AppPlugin uses — against the actions as
 * shipped. A body that fails to parse, references the wrong field, or is missing
 * entirely fails here, not in production.
 */
describe('showcase actions — executability', () => {
  const runner = new QuickJSScriptRunner();

  it('every declared `script` action is executable (has a body or a target)', () => {
    // Mirrors the platform invariant enforced by ActionSchema: a script action
    // must be bound to *something* runnable. `target` actions are wired
    // imperatively (e.g. via onEnable); `body` actions are auto-registered.
    const scriptActions = allActions.filter((a) => a.type === 'script');
    expect(scriptActions.length).toBeGreaterThan(0);
    for (const a of scriptActions) {
      expect(
        Boolean((a as { body?: unknown }).body) || Boolean((a as { target?: unknown }).target),
        `script action '${a.name}' has neither body nor target — it cannot be invoked`,
      ).toBe(true);
    }
  });

  it('the runtime produces a handler for Mark Done (regression: #2169)', () => {
    const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'showcase' });
    const handler = factory(MarkDoneAction as never);
    expect(typeof handler).toBe('function');
  });

  it('Mark Done flips `done` + `progress` via the sandboxed body', async () => {
    // Capture what the action writes through the proxied ObjectQL engine.
    let written: { object: string; data: Record<string, unknown> } | undefined;
    const ql = {
      object: (object: string) => ({
        update: async (data: Record<string, unknown>) => {
          written = { object, data };
          return { id: data.id };
        },
      }),
    };

    const factory = actionBodyRunnerFactory(runner, { ql, appId: 'showcase' });
    const handler = factory(MarkDoneAction as never);
    expect(typeof handler).toBe('function');

    const result = await handler!({
      recordId: 'task_1',
      record: { id: 'task_1', status: 'in_progress', progress: 40, done: false },
      params: {},
      user: { id: 'u1' },
    });

    // It updates the right object with the completion fields — and deliberately
    // does NOT touch `status` (the state-machine only permits in_review -> done).
    expect(written?.object).toBe('showcase_task');
    expect(written?.data).toMatchObject({ id: 'task_1', done: true, progress: 100 });
    expect(written?.data).not.toHaveProperty('status');
    expect(result).toEqual({ ok: true, id: 'task_1' });
  });

  it('a body-less `script` action yields no handler (the #2169 failure mode)', () => {
    // Documents exactly what used to ship: with neither body nor target the
    // runtime has nothing to register, so the HTTP action route falls into the
    // wildcard fallback. ActionSchema now rejects this at author time; this
    // asserts the runtime half of the contract.
    const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'showcase' });
    const handler = factory({ name: 'broken', object: 'showcase_task' } as never);
    expect(handler).toBeUndefined();
  });
});

/**
 * The object-less ("global") action specimen — framework#3913.
 *
 * #3913 was filed because object-less actions were unreachable: registered
 * under the canonical `'global'` key, looked up under `'*'`. Its follow-up then
 * found that `POST /api/v1/actions//:action` — the empty-object-segment URL the
 * issue was actually filed against — had no route registration at all. Both
 * were fixed with **no live specimen**: the showcase is the "one specimen of
 * everything" app and every action in it declared an `objectName`, so nothing
 * exercised the object-less dispatch path end to end.
 *
 * These tests pin the two properties that make it a specimen. The first is the
 * one that silently rots: adding an `objectName` to this action would still
 * build, still pass `coverage.test.ts`, and still work — while quietly removing
 * the app's only coverage of object-less dispatch.
 */
describe('showcase actions — the object-less (`global`) specimen', () => {
  const runner = new QuickJSScriptRunner();

  it('declares no object, so it keys at `global` (framework#3913)', () => {
    // This mirrors ObjectQLPlugin.actionObjectKey / AppPlugin's
    // `action.object || 'global'`: neither field set → the 'global' bucket.
    const a = PortfolioSnapshotAction as { objectName?: string; object?: string };
    expect(a.objectName).toBeUndefined();
    expect(a.object).toBeUndefined();

    // ...and it is the ONLY one, so this test is what keeps the specimen alive.
    const objectLess = allActions.filter((x) => {
      const y = x as { objectName?: string; object?: string };
      return !y.objectName && !y.object;
    });
    expect(objectLess.map((x) => x.name)).toEqual(['showcase_portfolio_snapshot']);
  });

  it('counts across several objects via the sandboxed body', async () => {
    // An object-less action has no record and no single object to hang off —
    // this body reads three, which is why it cannot be given an `objectName`.
    const counts: Record<string, number> = {
      showcase_account: 15,
      showcase_project: 5,
      showcase_invoice: 13,
    };
    const seen: string[] = [];
    const ql = {
      object: (object: string) => ({
        count: async () => {
          seen.push(object);
          return counts[object] ?? 0;
        },
      }),
    };

    const factory = actionBodyRunnerFactory(runner, { ql, appId: 'showcase' });
    const handler = factory(PortfolioSnapshotAction as never);
    expect(typeof handler).toBe('function');

    // No recordId, no record — the object-less invocation shape.
    const result = await handler!({ params: {}, user: { id: 'u1' } });

    expect(seen).toEqual(['showcase_account', 'showcase_project', 'showcase_invoice']);
    expect(result).toEqual({
      ok: true,
      scope: 'global',
      accounts: 15,
      projects: 5,
      invoices: 13,
    });
  });
});

/**
 * `type: 'modal'` targets a PAGE, only — the corpus pin (#6739).
 *
 * `showcase_new_task` used to declare `type: 'modal'` +
 * `target: 'showcase_component_gallery'`: a command labelled "New Task" whose
 * target named the showcase HOME PAGE. The dispatch was measured in a browser
 * while #6597 was being fixed — the dialog rendered the welcome page inside
 * itself, with **zero** form controls.
 *
 * The tempting one-key fix (point the modal at the `showcase_task` OBJECT) is
 * a BUILD ERROR, not a fix: `defineStack`'s cross-reference walk
 * (`packages/spec/src/stack.zod.ts`) accepts only declared PAGE names for a
 * modal target, which is also what the spec TSDoc and the published docs say.
 * objectui's page-then-object resolution is consumer leniency the renderer
 * itself labels "Back-compat" and is being retired (maintainer ruling on
 * #6739). Opening an object's form is `type: 'form'`'s job.
 *
 * These assertions pin the ruled shape on BOTH sites the name appears at, so
 * the corpus — which is reference material humans and AI authors copy — cannot
 * drift back:
 *  - registered actions: no `type: 'modal'` target that is not a declared page.
 *    That mirrors the build gate, so a regression fails here first with a
 *    readable message instead of as an import-time crash in nine other files;
 *  - INLINE page-element actions: the same rule, which the build gate does NOT
 *    enforce — the cross-reference walk visits `config.actions` only and never
 *    an inline action (#6889). This is the corpus's own guard over that hole,
 *    and it is exactly how the old `element:button` line built while depending
 *    on the object branch;
 *  - `showcase_new_task` itself is `type: 'form'` at a FORM view, structurally
 *    identical to `showcase_log_time`.
 */
describe("showcase actions — a `type: 'modal'` target names a page (#6739)", () => {
  type AnyAction = { name?: unknown; type?: unknown; target?: unknown };
  type AnyComponent = { type?: unknown; properties?: Record<string, unknown> };

  /** Every page name the showcase declares — the set a modal target may name. */
  const pageNames = new Set(
    (Object.values(pages) as unknown[])
      .filter(
        (p): p is { name: string } =>
          !!p && typeof p === 'object' && !Array.isArray(p) && typeof (p as { name?: unknown }).name === 'string',
      )
      .map((p) => p.name),
  );

  /** Every component on every page — regions and slots alike, nesting included. */
  function allComponents(page: Record<string, unknown>): AnyComponent[] {
    const out: AnyComponent[] = [];
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const component = node as AnyComponent;
      out.push(component);
      const props = component.properties;
      if (!props) return;
      for (const item of Array.isArray(props.items) ? props.items : []) {
        const children = (item as { children?: unknown })?.children;
        for (const child of Array.isArray(children) ? children : []) visit(child);
      }
      for (const child of Array.isArray(props.children) ? props.children : []) visit(child);
    };
    for (const region of (page.regions as { components?: unknown[] }[] | undefined) ?? []) {
      for (const c of region.components ?? []) visit(c);
    }
    for (const slot of Object.values((page.slots as Record<string, unknown>) ?? {})) {
      for (const c of Array.isArray(slot) ? slot : [slot]) visit(c);
    }
    return out;
  }

  /** Inline actions authored on a page element (`element:button`'s `action`). */
  const inlineActions = (): { page: string; action: AnyAction }[] => {
    const out: { page: string; action: AnyAction }[] = [];
    for (const page of Object.values(pages) as unknown[]) {
      if (!page || typeof page !== 'object' || Array.isArray(page)) continue;
      const p = page as Record<string, unknown>;
      if (typeof p.name !== 'string') continue;
      for (const component of allComponents(p)) {
        const action = component.properties?.action;
        if (action && typeof action === 'object' && !Array.isArray(action)) {
          out.push({ page: p.name, action: action as AnyAction });
        }
      }
    }
    return out;
  };

  it('the page set the corpus can target is non-empty', () => {
    // Guards the assertions below against passing vacuously: an empty page set
    // would make "targets a declared page" trivially unfalsifiable.
    expect(pageNames.size).toBeGreaterThan(10);
    expect(pageNames.has('showcase_component_gallery')).toBe(true);
  });

  it('every REGISTERED modal action targets a declared page', () => {
    const modals = (allActions as AnyAction[]).filter((a) => a.type === 'modal');
    // Keep the modal-targeting-a-page specimen alive: if this ever hits zero
    // the rule below stops being exercised by anything.
    expect(modals.length).toBeGreaterThan(0);
    for (const a of modals) {
      expect(
        pageNames.has(String(a.target)),
        `action '${String(a.name)}': a modal target names a PAGE, but '${String(a.target)}' is not a declared page — ` +
          `use type: 'form' with an <object>.<view> target to open a form (#6739)`,
      ).toBe(true);
    }
  });

  it('every INLINE page-element modal action targets a declared page too', () => {
    // The build gate cannot see these (#6889): `defineStack`'s cross-reference
    // walk visits `config.actions` only. This is the corpus's own guard.
    const inline = inlineActions();
    expect(inline.length).toBeGreaterThan(0);
    for (const { page, action } of inline) {
      if (action.type !== 'modal') continue;
      expect(
        pageNames.has(String(action.target)),
        `page '${page}': inline action '${String(action.name)}' is type:'modal' targeting ` +
          `'${String(action.target)}', which is not a declared page (#6739)`,
      ).toBe(true);
    }
  });

  it("`showcase_new_task` opens the Task form — type: 'form' at a FORM view", () => {
    expect(NewTaskAction.type).toBe('form');
    expect(NewTaskAction.target).toBe('showcase_task.edit');

    // Both sites carrying the name agree, so the corpus teaches one shape.
    const inline = inlineActions()
      .map(({ action }) => action)
      .filter((a) => a.name === 'showcase_new_task');
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatchObject({ type: 'form', target: 'showcase_task.edit' });
  });
});
