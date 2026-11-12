import { describe, it, expect } from 'vitest';
import {
  composeStacks,
  ComposeStacksOptionsSchema,
  ConflictStrategySchema,
  defineStack,
  type ObjectStackDefinition,
  type ComposeStacksOptions,
  type ConflictStrategy,
} from './stack.zod';

// ─── Helper factories ──────────────────────────────────────────────

function makeStack(overrides: Partial<ObjectStackDefinition> = {}): ObjectStackDefinition {
  return defineStack({ ...overrides }, { strict: false });
}

const manifest1 = {
  id: 'com.example.crm',
  name: 'crm',
  version: '1.0.0',
  type: 'app' as const,
};

const manifest2 = {
  id: 'com.example.todo',
  name: 'todo',
  version: '2.0.0',
  type: 'app' as const,
};

// ─── Schema tests ──────────────────────────────────────────────────

describe('ConflictStrategySchema', () => {
  it('should accept valid strategies', () => {
    expect(ConflictStrategySchema.parse('error')).toBe('error');
    expect(ConflictStrategySchema.parse('override')).toBe('override');
    expect(ConflictStrategySchema.parse('merge')).toBe('merge');
  });

  it('should reject invalid strategies', () => {
    expect(() => ConflictStrategySchema.parse('invalid')).toThrow();
  });
});

describe('ComposeStacksOptionsSchema', () => {
  it('should apply defaults', () => {
    const result = ComposeStacksOptionsSchema.parse({});
    expect(result.objectConflict).toBe('error');
    expect(result.manifest).toBe('last');
    expect(result.namespace).toBeUndefined();
  });

  it('should accept all valid option combinations', () => {
    const opts = ComposeStacksOptionsSchema.parse({
      objectConflict: 'merge',
      manifest: 'first',
      namespace: 'crm',
    });
    expect(opts.objectConflict).toBe('merge');
    expect(opts.manifest).toBe('first');
    expect(opts.namespace).toBe('crm');
  });

  it('should accept numeric manifest index', () => {
    const opts = ComposeStacksOptionsSchema.parse({ manifest: 0 });
    expect(opts.manifest).toBe(0);
  });

  it('should reject negative manifest index', () => {
    expect(() => ComposeStacksOptionsSchema.parse({ manifest: -1 })).toThrow();
  });
});

// ─── composeStacks core ────────────────────────────────────────────

describe('composeStacks', () => {
  it('should return empty stack for empty input', () => {
    const result = composeStacks([]);
    expect(result).toEqual({});
  });

  it('should return the single stack unchanged', () => {
    const stack = makeStack({ manifest: manifest1 });
    const result = composeStacks([stack]);
    expect(result).toBe(stack);
  });

  it('should concatenate apps from multiple stacks', () => {
    const crm = makeStack({
      apps: [{ name: 'sales', label: 'Sales' }],
    });
    const todo = makeStack({
      apps: [{ name: 'tasks', label: 'Tasks' }],
    });

    const result = composeStacks([crm, todo]);
    expect(result.apps).toHaveLength(2);
    expect(result.apps![0].name).toBe('sales');
    expect(result.apps![1].name).toBe('tasks');
  });

  it('should concatenate views from multiple stacks', () => {
    const s1 = makeStack({
      views: [{ list: { type: 'grid', columns: ['title'] } }],
    });
    const s2 = makeStack({
      views: [{ list: { type: 'kanban', columns: ['status'] } }],
    });

    const result = composeStacks([s1, s2]);
    expect(result.views).toHaveLength(2);
  });

  it('should concatenate dashboards from multiple stacks', () => {
    const s1 = makeStack({
      dashboards: [{ name: 'crm_overview', label: 'CRM Overview', widgets: [] }],
    });
    const s2 = makeStack({
      dashboards: [{ name: 'todo_stats', label: 'Todo Stats', widgets: [] }],
    });

    const result = composeStacks([s1, s2]);
    expect(result.dashboards).toHaveLength(2);
  });

  it('should concatenate reports from multiple stacks', () => {
    const s1 = makeStack({
      reports: [{ name: 'sales_report', label: 'Sales', object: 'account', type: 'tabular' }],
    });
    const s2 = makeStack({
      reports: [{ name: 'task_report', label: 'Tasks', object: 'task', type: 'tabular' }],
    });

    const result = composeStacks([s1, s2]);
    expect(result.reports).toHaveLength(2);
  });

  it('should concatenate pages from multiple stacks', () => {
    const s1 = makeStack({
      pages: [{
        name: 'home',
        label: 'Home',
        type: 'app',
        route: '/home',
        regions: [{ name: 'main', components: [{ type: 'page:section', properties: {} }] }],
      }],
    });
    const s2 = makeStack({
      pages: [{
        name: 'settings',
        label: 'Settings',
        type: 'app',
        route: '/settings',
        regions: [{ name: 'main', components: [{ type: 'page:section', properties: {} }] }],
      }],
    });

    const result = composeStacks([s1, s2]);
    expect(result.pages).toHaveLength(2);
  });

  it('should concatenate data (seed datasets) from multiple stacks', () => {
    const s1 = makeStack({
      data: [{ object: 'account', records: [{ name: 'Acme' }] }],
    });
    const s2 = makeStack({
      data: [{ object: 'task', records: [{ subject: 'Test' }] }],
    });

    const result = composeStacks([s1, s2]);
    expect(result.data).toHaveLength(2);
  });

  it('should concatenate plugins and devPlugins', () => {
    const s1 = makeStack({ plugins: ['plugin-a'], devPlugins: ['dev-a'] });
    const s2 = makeStack({ plugins: ['plugin-b'], devPlugins: ['dev-b'] });

    const result = composeStacks([s1, s2]);
    expect(result.plugins).toEqual(['plugin-a', 'plugin-b']);
    expect(result.devPlugins).toEqual(['dev-a', 'dev-b']);
  });

  it('should skip undefined array fields (no empty arrays in output)', () => {
    const s1 = makeStack({ objects: [{ name: 'task', fields: { title: { type: 'text' } } }] });
    const s2 = makeStack({ objects: [{ name: 'project', fields: { name: { type: 'text' } } }] });

    const result = composeStacks([s1, s2]);
    expect(result.apps).toBeUndefined();
    expect(result.views).toBeUndefined();
    expect(result.dashboards).toBeUndefined();
  });

  it('should compose three or more stacks', () => {
    const s1 = makeStack({
      apps: [{ name: 'app1', label: 'App 1' }],
      objects: [{ name: 'obj_a', fields: { f: { type: 'text' } } }],
    });
    const s2 = makeStack({
      apps: [{ name: 'app2', label: 'App 2' }],
      objects: [{ name: 'obj_b', fields: { f: { type: 'text' } } }],
    });
    const s3 = makeStack({
      apps: [{ name: 'app3', label: 'App 3' }],
      objects: [{ name: 'obj_c', fields: { f: { type: 'text' } } }],
    });

    const result = composeStacks([s1, s2, s3]);
    expect(result.apps).toHaveLength(3);
    expect(result.objects).toHaveLength(3);
  });
});

// ─── Manifest strategy ─────────────────────────────────────────────

describe('composeStacks - manifest strategy', () => {
  it('should use last manifest by default', () => {
    const s1 = makeStack({ manifest: manifest1 });
    const s2 = makeStack({ manifest: manifest2 });

    const result = composeStacks([s1, s2]);
    expect(result.manifest?.name).toBe('todo');
  });

  it('should use first manifest when specified', () => {
    const s1 = makeStack({ manifest: manifest1 });
    const s2 = makeStack({ manifest: manifest2 });

    const result = composeStacks([s1, s2], { manifest: 'first' });
    expect(result.manifest?.name).toBe('crm');
  });

  it('should use manifest at specific index', () => {
    const s1 = makeStack({ manifest: manifest1 });
    const s2 = makeStack({ manifest: manifest2 });

    const result = composeStacks([s1, s2], { manifest: 0 });
    expect(result.manifest?.name).toBe('crm');

    const result2 = composeStacks([s1, s2], { manifest: 1 });
    expect(result2.manifest?.name).toBe('todo');
  });

  it('should skip stacks without manifest for first/last', () => {
    const s1 = makeStack({});
    const s2 = makeStack({ manifest: manifest2 });

    const result = composeStacks([s1, s2], { manifest: 'first' });
    expect(result.manifest?.name).toBe('todo');
  });

  it('should return undefined manifest when no stacks have one', () => {
    const s1 = makeStack({});
    const s2 = makeStack({});

    const result = composeStacks([s1, s2]);
    expect(result.manifest).toBeUndefined();
  });
});

// ─── i18n handling ──────────────────────────────────────────────────

describe('composeStacks - i18n', () => {
  // #5051 flipped this case: `i18n` used to be last-wins, so composing these
  // two stacks silently produced `zh` and threw `s1`'s declaration away. It is
  // now a single-valued key like `api` / `server` — a disagreement is an error.
  it('should throw on conflicting i18n config rather than letting the last stack win', () => {
    const s1 = makeStack({ i18n: { defaultLocale: 'en', supportedLocales: ['en'] } });
    const s2 = makeStack({ i18n: { defaultLocale: 'zh', supportedLocales: ['zh', 'en'] } });

    expect(() => composeStacks([s1, s2])).toThrow(/top-level key 'i18n'/);
  });

  it('should pass an identical i18n config through', () => {
    const config = { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] };
    const s1 = makeStack({ i18n: { ...config } });
    const s2 = makeStack({ i18n: { ...config } });

    expect(composeStacks([s1, s2]).i18n).toEqual(config);
  });

  it('should skip stacks without i18n', () => {
    const s1 = makeStack({ i18n: { defaultLocale: 'en', supportedLocales: ['en'] } });
    const s2 = makeStack({});

    const result = composeStacks([s1, s2]);
    expect(result.i18n?.defaultLocale).toBe('en');
  });
});

// ─── Object conflict strategy ───────────────────────────────────────

describe('composeStacks - objectConflict: error (default)', () => {
  it('should merge non-overlapping objects from multiple stacks', () => {
    const s1 = makeStack({
      objects: [{ name: 'account', fields: { name: { type: 'text' } } }],
    });
    const s2 = makeStack({
      objects: [{ name: 'task', fields: { title: { type: 'text' } } }],
    });

    const result = composeStacks([s1, s2]);
    expect(result.objects).toHaveLength(2);
    expect(result.objects![0].name).toBe('account');
    expect(result.objects![1].name).toBe('task');
  });

  it('should throw on duplicate object names by default', () => {
    const s1 = makeStack({
      objects: [{ name: 'account', fields: { name: { type: 'text' } } }],
    });
    const s2 = makeStack({
      objects: [{ name: 'account', fields: { email: { type: 'email' } } }],
    });

    expect(() => composeStacks([s1, s2])).toThrow("object 'account' is defined in multiple stacks");
  });

  it('should throw on duplicate objects explicitly with error strategy', () => {
    const s1 = makeStack({
      objects: [{ name: 'contact', fields: { name: { type: 'text' } } }],
    });
    const s2 = makeStack({
      objects: [{ name: 'contact', fields: { phone: { type: 'phone' } } }],
    });

    expect(() => composeStacks([s1, s2], { objectConflict: 'error' })).toThrow('contact');
  });
});

describe('composeStacks - objectConflict: override', () => {
  it('should override duplicate objects (last-wins)', () => {
    const s1 = makeStack({
      objects: [{
        name: 'account',
        label: 'Account v1',
        fields: { name: { type: 'text' }, old_field: { type: 'text' } },
      }],
    });
    const s2 = makeStack({
      objects: [{
        name: 'account',
        label: 'Account v2',
        fields: { name: { type: 'text' }, new_field: { type: 'number' } },
      }],
    });

    const result = composeStacks([s1, s2], { objectConflict: 'override' });
    expect(result.objects).toHaveLength(1);
    expect(result.objects![0].label).toBe('Account v2');
    expect(result.objects![0].fields).toHaveProperty('new_field');
    // old_field should NOT be present (full override)
    expect(result.objects![0].fields).not.toHaveProperty('old_field');
  });

  it('should keep non-overlapping objects alongside overridden ones', () => {
    const s1 = makeStack({
      objects: [
        { name: 'account', fields: { name: { type: 'text' } } },
        { name: 'task', fields: { title: { type: 'text' } } },
      ],
    });
    const s2 = makeStack({
      objects: [{ name: 'account', fields: { email: { type: 'email' } } }],
    });

    const result = composeStacks([s1, s2], { objectConflict: 'override' });
    expect(result.objects).toHaveLength(2);
    expect(result.objects![0].name).toBe('account');
    expect(result.objects![0].fields).toHaveProperty('email');
    expect(result.objects![1].name).toBe('task');
  });
});

describe('composeStacks - objectConflict: merge', () => {
  it('should shallow-merge duplicate objects (later fields win)', () => {
    const s1 = makeStack({
      objects: [{
        name: 'account',
        label: 'Account v1',
        fields: { name: { type: 'text' }, industry: { type: 'text' } },
      }],
    });
    const s2 = makeStack({
      objects: [{
        name: 'account',
        label: 'Account v2',
        fields: { email: { type: 'email' } },
      }],
    });

    const result = composeStacks([s1, s2], { objectConflict: 'merge' });
    expect(result.objects).toHaveLength(1);
    expect(result.objects![0].label).toBe('Account v2');
    // Fields from both stacks should be present
    expect(result.objects![0].fields).toHaveProperty('name');
    expect(result.objects![0].fields).toHaveProperty('industry');
    expect(result.objects![0].fields).toHaveProperty('email');
  });

  it('should let later field definitions win on field-level conflicts', () => {
    const s1 = makeStack({
      objects: [{
        name: 'account',
        fields: { status: { type: 'text' } },
      }],
    });
    const s2 = makeStack({
      objects: [{
        name: 'account',
        fields: { status: { type: 'select', options: [{ label: 'Active', value: 'active' }] } },
      }],
    });

    const result = composeStacks([s1, s2], { objectConflict: 'merge' });
    expect(result.objects![0].fields.status.type).toBe('select');
  });

  it('should merge three stacks with overlapping objects', () => {
    const s1 = makeStack({
      objects: [{ name: 'account', fields: { name: { type: 'text' } } }],
    });
    const s2 = makeStack({
      objects: [{ name: 'account', fields: { email: { type: 'email' } } }],
    });
    const s3 = makeStack({
      objects: [{ name: 'account', fields: { phone: { type: 'phone' } } }],
    });

    const result = composeStacks([s1, s2, s3], { objectConflict: 'merge' });
    expect(result.objects).toHaveLength(1);
    expect(result.objects![0].fields).toHaveProperty('name');
    expect(result.objects![0].fields).toHaveProperty('email');
    expect(result.objects![0].fields).toHaveProperty('phone');
  });
});

// ─── Type safety checks ────────────────────────────────────────────

describe('composeStacks - type safety', () => {
  it('return type should be ObjectStackDefinition', () => {
    const stack: ObjectStackDefinition = composeStacks([]);
    expect(stack).toBeDefined();
  });

  it('options type should accept ComposeStacksOptions', () => {
    const opts: ComposeStacksOptions = {
      objectConflict: 'merge',
      manifest: 'first',
      namespace: 'test',
    };
    // Should not throw
    const result = composeStacks([], opts);
    expect(result).toBeDefined();
  });

  it('ConflictStrategy type should match enum values', () => {
    const strategies: ConflictStrategy[] = ['error', 'override', 'merge'];
    for (const s of strategies) {
      expect(ConflictStrategySchema.parse(s)).toBe(s);
    }
  });
});

// ─── Integration with defineStack ───────────────────────────────────

describe('composeStacks + defineStack integration', () => {
  it('should compose outputs of defineStack', () => {
    const crm = defineStack({
      manifest: manifest1,
      objects: { account: { fields: { name: { type: 'text' } } } },
      apps: { sales: { label: 'Sales', objects: ['account'] } },
    }, { strict: false });

    const todo = defineStack({
      manifest: manifest2,
      objects: { task: { fields: { title: { type: 'text' } } } },
      apps: { todo_app: { label: 'Todo', objects: ['task'] } },
    }, { strict: false });

    const combined = composeStacks([crm, todo]);
    expect(combined.objects).toHaveLength(2);
    expect(combined.apps).toHaveLength(2);
    expect(combined.manifest?.name).toBe('todo'); // last-wins default
  });

  it('composed result should be valid for defineStack re-validation', () => {
    const s1 = defineStack({
      objects: [{ name: 'task', fields: { title: { type: 'text' } } }],
    });
    const s2 = defineStack({
      objects: [{ name: 'project', fields: { name: { type: 'text' } } }],
    });

    const combined = composeStacks([s1, s2]);
    // Re-validate the composed result through defineStack
    expect(() => defineStack(combined)).not.toThrow();
  });

  it('should merge actions into objects across composed stacks', () => {
    const s1 = makeStack({
      objects: [{ name: 'task', fields: { title: { type: 'text' } } }],
    });
    const s2 = makeStack({
      actions: [{ name: 'complete_task', label: 'Complete', objectName: 'task' }],
    });

    const combined = composeStacks([s1, s2]);
    expect(combined.objects![0].actions).toHaveLength(1);
    expect(combined.objects![0].actions![0].name).toBe('complete_task');
    // Top-level actions preserved
    expect(combined.actions).toHaveLength(1);
  });
});

// ─── Action `order` sorting (mergeActionsIntoObjects) ───────────────
// Regression coverage for #2670: the record-header primary button is the first
// visible `record_header` action, so `order` must control which action lands
// first — instead of fragile cross-file registration order.

describe('Action order sorting', () => {
  it("sorts an object's inline actions by `order` (lower = earlier / primary slot)", () => {
    // Registration order puts the app action first; a negative `order` must
    // float Approve up into the primary-button slot.
    const stack = makeStack({
      objects: [
        {
          name: 'deal',
          fields: { title: { type: 'text' } },
          actions: [
            { name: 'close_deal', label: 'Close', locations: ['record_header'] },
            { name: 'print', label: 'Print', locations: ['record_header'], order: 5 },
            { name: 'approve', label: 'Approve', locations: ['record_header'], order: -10 },
          ],
        },
      ],
    });

    const names = stack.objects![0].actions!.map((a) => a.name);
    // approve (-10) → close_deal (unset = 0) → print (5)
    expect(names).toEqual(['approve', 'close_deal', 'print']);
    // What objectui renders as the primary button is now the approval decision.
    expect(names[0]).toBe('approve');
  });

  it('is STABLE — actions that tie on `order` (incl. all-unset) keep registration order', () => {
    const stack = makeStack({
      objects: [
        {
          name: 'deal',
          fields: { title: { type: 'text' } },
          actions: [
            { name: 'a', label: 'A' },
            { name: 'b', label: 'B' },
            { name: 'c', label: 'C' },
          ],
        },
      ],
    });
    expect(stack.objects![0].actions!.map((a) => a.name)).toEqual(['a', 'b', 'c']);
  });

  it('interleaves merged top-level actions with inline actions by `order`', () => {
    const stack = makeStack({
      objects: [
        {
          name: 'deal',
          fields: { title: { type: 'text' } },
          actions: [{ name: 'inline_mid', label: 'Mid', order: 0 }],
        },
      ],
      actions: [
        { name: 'top_first', label: 'First', objectName: 'deal', order: -5 },
        { name: 'top_last', label: 'Last', objectName: 'deal', order: 5 },
      ],
    });
    expect(stack.objects![0].actions!.map((a) => a.name)).toEqual([
      'top_first',
      'inline_mid',
      'top_last',
    ]);
  });

  it('is backward compatible — no `order` anywhere leaves the merged order untouched', () => {
    const stack = makeStack({
      objects: [
        {
          name: 'deal',
          fields: { title: { type: 'text' } },
          actions: [{ name: 'inline', label: 'Inline' }],
        },
      ],
      actions: [{ name: 'merged', label: 'Merged', objectName: 'deal' }],
    });
    // Inline first (pre-existing behaviour), then the merged top-level action.
    expect(stack.objects![0].actions!.map((a) => a.name)).toEqual(['inline', 'merged']);
  });

  it('sorts the top-level (global) actions array by `order` too', () => {
    const stack = makeStack({
      actions: [
        { name: 'g_b', label: 'B', order: 2 },
        { name: 'g_a', label: 'A', order: 1 },
      ],
    });
    expect(stack.actions!.map((a) => a.name)).toEqual(['g_a', 'g_b']);
  });

  it('respects `order` when composing stacks (funnels through mergeActionsIntoObjects)', () => {
    const base = makeStack({
      objects: [
        {
          name: 'deal',
          fields: { title: { type: 'text' } },
          actions: [{ name: 'app_action', label: 'App', locations: ['record_header'] }],
        },
      ],
    });
    // A plugin (e.g. plugin-approvals) contributes a high-priority decision.
    const approvals = makeStack({
      actions: [
        { name: 'approve', label: 'Approve', objectName: 'deal', locations: ['record_header'], order: -100 },
      ],
    });
    const combined = composeStacks([base, approvals]);
    expect(combined.objects![0].actions!.map((a) => a.name)).toEqual(['approve', 'app_action']);
  });
});

/**
 * [ADR-0150 D4 · #32477] A NESTED artifact — one `composeStacks` built under
 * `manifest: 'preserve'`, composed again — keeps its objects in its package
 * bodies and carries no flattened copy, so the object door reads those bodies:
 * an object name a body declares and another input declares too is refused
 * under EVERY `objectConflict` strategy (seat ruling on #32477, option A).
 *
 * Measured on #32475's head 8be0f346 before this read existed (A = p1 + p2
 * under 'preserve', p1 declaring `alpha_shared`; q, a co-owner of namespace
 * alpha, declaring `alpha_shared` too):
 *
 * ```
 * flat p1 + q, 'error'           : REFUSED STACK_COMPOSE_OBJECT_CONFLICT 422 (unchanged)
 * A + q, any strategy, 'preserve': ACCEPTED — the boot refuses DUPLICATE_ARTIFACT_OBJECT_NAME 422
 * A + q, any strategy, default   : ACCEPTED — the boot serves p1's object; q's fields and actions are gone
 * install p1, p2, q one by one   : q REFUSED DUPLICATE_ARTIFACT_OBJECT_NAME 422
 * ```
 */
describe('composeStacks - a nested artifact\'s package bodies are read for object name conflicts', () => {
  const CONFLICT = 'STACK_COMPOSE_OBJECT_CONFLICT';
  const X = 'alpha_shared';
  const obj = (name: string, from: string, approve = false) => ({
    name,
    label: `${name} from ${from}`,
    fields: { [`only_${from}`]: { type: 'text' as const, label: from } },
    ...(approve ? { actions: [{ name: 'approve', label: `approve ${from}`, type: 'script' as const, body: { language: 'js', source: `return '${from}';`, capabilities: [] } }] } : {}),
  });
  const pkg = (id: string, namespace: string, objects: ReturnType<typeof obj>[], extra: Record<string, unknown> = {}) =>
    defineStack({
      manifest: { id: `com.example.${id}`, name: id, version: '1.0.0', type: 'module' as const, namespace, ...extra },
      objects,
    } as never);
  const p1 = (approve = false) => pkg('p1', 'alpha', [obj(X, 'p1', approve), obj('alpha_p1_item', 'p1')]);
  const p2 = () => pkg('p2', 'beta', [obj('beta_p2_item', 'p2')]);
  const q = (approve = false) =>
    pkg('q', 'alpha', [obj(X, 'q', approve)], { dependencies: { 'com.example.p1': '^1.0.0' } });
  /** A: p1 (declares `alpha_shared`) and p2, composed under 'preserve' — stripped, bodies only. */
  const nested = (approve = false) => composeStacks([p1(approve), p2()], { manifest: 'preserve' });
  const thrown = (fn: () => unknown): { code?: string; status?: number; issues?: unknown; message: string } | undefined => {
    try {
      fn();
      return undefined;
    } catch (e) {
      return e as { code?: string; status?: number; issues?: unknown; message: string };
    }
  };
  const BODY_SITE = "at packages[0].objects['alpha_shared'] (package 'com.example.p1', namespace 'alpha')";
  const issueFor = (order: 'nested-first' | 'flat-first') =>
    order === 'nested-first'
      ? `object '${X}' is defined in multiple stacks: 'com.example.p2' (stack #0) ${BODY_SITE} and 'com.example.q' (stack #1) at stack.objects[0].`
      : `object '${X}' is defined in multiple stacks: 'com.example.q' (stack #0) at stack.objects[0] and 'com.example.p2' (stack #1) ${BODY_SITE}.`;

  it('the nested input carries its objects only in its bodies (the shape the read exists for)', () => {
    const a = nested();
    expect(a.objects).toBeUndefined();
    expect((a.packages ?? []).map((p) => (p.manifest as { id?: string }).id)).toEqual(['com.example.p1', 'com.example.p2']);
  });

  for (const objectConflict of ['error', 'override', 'merge'] as const) {
    for (const manifest of ['preserve', undefined] as const) {
      it(`refuses the nested + flat pair under '${objectConflict}', manifest ${manifest ?? 'default'}, in either order`, () => {
        const opts: ComposeStacksOptions = { objectConflict, ...(manifest ? { manifest } : {}) };
        const nestedFirst = thrown(() => composeStacks([nested(), q()], opts));
        expect([nestedFirst?.code, nestedFirst?.status]).toEqual([CONFLICT, 422]);
        expect(nestedFirst?.issues).toEqual([issueFor('nested-first')]);
        const flatFirst = thrown(() => composeStacks([q(), nested()], opts));
        expect([flatFirst?.code, flatFirst?.status]).toEqual([CONFLICT, 422]);
        expect(flatFirst?.issues).toEqual([issueFor('flat-first')]);
      });
    }
  }

  it('refuses the pair at the object door when both sides embed `approve` on the object, before the action check', () => {
    for (const manifest of ['preserve', undefined] as const) {
      const err = thrown(() => composeStacks([nested(true), q(true)], manifest ? { manifest } : {}));
      expect([err?.code, err?.status]).toEqual([CONFLICT, 422]);
      expect(err?.issues).toEqual([issueFor('nested-first')]);
    }
  });

  it('refuses two nested artifacts whose bodies declare one object name', () => {
    const p3 = pkg('p3', 'gamma', [obj('gamma_p3_item', 'p3')]);
    const other = composeStacks([q(), p3], { manifest: 'preserve' });
    const err = thrown(() => composeStacks([nested(), other], { manifest: 'preserve' }));
    expect([err?.code, err?.status]).toEqual([CONFLICT, 422]);
    expect(err?.issues).toEqual([
      `object '${X}' is defined in multiple stacks: 'com.example.p2' (stack #0) ${BODY_SITE} and ` +
        `'com.example.p3' (stack #1) at packages[0].objects['alpha_shared'] (package 'com.example.q', namespace 'alpha').`,
    ]);
  });

  it('refuses the same holder on both sides: a flat package beside an artifact that carries that package', () => {
    const err = thrown(() => composeStacks([nested(), p1()]));
    expect([err?.code, err?.status]).toEqual([CONFLICT, 422]);
    expect(err?.issues).toEqual([
      issueFor('nested-first').replace("'com.example.q' (stack #1)", "'com.example.p1' (stack #1)"),
      `object 'alpha_p1_item' is defined in multiple stacks: 'com.example.p2' (stack #0) at packages[0].objects['alpha_p1_item'] ` +
        `(package 'com.example.p1', namespace 'alpha') and 'com.example.p1' (stack #1) at stack.objects[1].`,
    ]);
  });

  it("CONTROL — an input whose own top level also carries the body's object is judged by the top-level walk, as before", () => {
    const loose = defineStack({ objects: [obj('loose_item', 'loose')] } as never);
    // A manifest-less input keeps the flattened copy, so this artifact carries
    // `alpha_shared` at its top level AND in p1's body: the top level claims it.
    const additive = composeStacks([p1(), loose], { manifest: 'preserve' });
    expect((additive.objects ?? []).map((o) => o.name)).toContain(X);
    expect((additive.packages ?? []).map((p) => (p.manifest as { id?: string }).id)).toEqual(['com.example.p1']);
    const err = thrown(() => composeStacks([additive, q()]));
    expect([err?.code, err?.status]).toEqual([CONFLICT, 422]);
    expect(err?.issues).toEqual([`object '${X}' is defined in multiple stacks.`]);
  });

  it('CONTROL — the flat pair is judged as before: refused under error with its own issue, reconciled under override', () => {
    const err = thrown(() => composeStacks([p1(), q()]));
    expect([err?.code, err?.status]).toEqual([CONFLICT, 422]);
    expect(err?.issues).toEqual([`object '${X}' is defined in multiple stacks.`]);
    const out = composeStacks([p1(), q()], { objectConflict: 'override' });
    expect(out.objects?.find((o) => o.name === X)?.label).toBe(`${X} from q`);
  });

  it('CONTROL — a nested artifact beside a package declaring a different object still composes, output unchanged', () => {
    const r = pkg('r', 'gamma', [obj('gamma_r_item', 'r')]);
    const preserved = composeStacks([nested(), r], { manifest: 'preserve' });
    expect((preserved.packages ?? []).map((p) => (p.manifest as { id?: string }).id)).toEqual([
      'com.example.p1',
      'com.example.p2',
      'com.example.r',
    ]);
    const flattened = composeStacks([nested(), r]);
    expect((flattened.objects ?? []).map((o) => o.name)).toEqual(['gamma_r_item']);
  });
});
