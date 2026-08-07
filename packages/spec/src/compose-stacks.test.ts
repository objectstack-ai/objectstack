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
      apps: [{ name: 'sales', label: 'Sales', objects: ['account'] }],
    });
    const todo = makeStack({
      apps: [{ name: 'tasks', label: 'Tasks', objects: ['task'] }],
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
