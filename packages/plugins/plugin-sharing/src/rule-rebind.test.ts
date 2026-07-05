// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sharing-rule hook rebind on `sys_sharing_rule` DATA changes (#2592).
 *
 * `bindRuleHooks` runs once at kernel:ready with the rules that existed at
 * boot, registering lifecycle hooks only for objects that had ≥1 rule then.
 * A rule created at runtime for an object with no boot-time rule therefore
 * never evaluated until restart — and because rule authoring is a data
 * insert (not a metadata publish), the `metadata:reloaded` rebind pattern
 * never fires. The plugin now binds afterInsert/afterUpdate/afterDelete
 * triggers on `sys_sharing_rule` itself that unbind + re-bind the whole
 * rule-hook package from a fresh `listRules()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SharingServicePlugin } from './sharing-plugin.js';
import {
  SHARING_RULE_HOOK_PACKAGE,
  RULE_REBIND_TRIGGER_PACKAGE,
} from './rule-hooks.js';

type AnyRecord = Record<string, any>;
type HookEntry = { event: string; handler: (ctx: any) => any; options: AnyRecord };

function makeEngine() {
  const hooks: HookEntry[] = [];
  return {
    hooks,
    registerHook: vi.fn((event: string, handler: (ctx: any) => any, options: AnyRecord = {}) => {
      hooks.push({ event, handler, options });
    }),
    unregisterHooksByPackage: vi.fn((packageId: string) => {
      let removed = 0;
      for (let i = hooks.length - 1; i >= 0; i--) {
        if (hooks[i].options.packageId === packageId) { hooks.splice(i, 1); removed++; }
      }
      return removed;
    }),
    /** Test helper: hooks bound for a given package. */
    boundFor(packageId: string): HookEntry[] {
      return hooks.filter((h) => h.options.packageId === packageId);
    },
    /** Test helper: fire the rebind trigger like a real rule write would. */
    async fire(event: string, object: string, ctx: AnyRecord = {}) {
      for (const h of [...hooks]) {
        if (h.event === event && h.options.object === object) await h.handler(ctx);
      }
    },
  };
}

function makeCtx() {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as AnyRecord;
}

describe('SharingServicePlugin sys_sharing_rule data-change rebind (#2592)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let plugin: SharingServicePlugin;
  let rules: AnyRecord[];
  let ruleService: AnyRecord;

  beforeEach(() => {
    engine = makeEngine();
    plugin = new SharingServicePlugin();
    rules = [];
    ruleService = {
      listRules: vi.fn(async () => rules),
    };
    (plugin as any).ruleService = ruleService;
    (plugin as any).bindRuleRebindTriggers(engine, makeCtx());
  });

  it('binds insert/update/delete triggers on sys_sharing_rule under its own package id', () => {
    const triggers = engine.boundFor(RULE_REBIND_TRIGGER_PACKAGE);
    expect(triggers.map((t) => t.event).sort()).toEqual(['afterDelete', 'afterInsert', 'afterUpdate']);
    for (const t of triggers) expect(t.options.object).toBe('sys_sharing_rule');
  });

  it('binds the FIRST rule for an object without a restart (the #2592 repro)', async () => {
    // Boot state: no rules at all → bindRuleHooks bound nothing.
    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE)).toHaveLength(0);

    // Runtime: admin creates the first rule for `project` (a data insert).
    rules = [{ name: 'r1', object_name: 'project', active: true }];
    await engine.fire('afterInsert', 'sys_sharing_rule', { result: { id: 'r1' } });

    const bound = engine.boundFor(SHARING_RULE_HOOK_PACKAGE);
    expect(bound.map((h) => h.event).sort()).toEqual(['afterInsert', 'afterUpdate']);
    for (const h of bound) expect(h.options.object).toBe('project');
  });

  it('tears down hooks when the last rule for an object is deleted', async () => {
    rules = [{ name: 'r1', object_name: 'project', active: true }];
    await engine.fire('afterInsert', 'sys_sharing_rule', {});
    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE)).toHaveLength(2);

    rules = [];
    await engine.fire('afterDelete', 'sys_sharing_rule', {});

    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE)).toHaveLength(0);
  });

  it('never unbinds its own rebind triggers when re-binding', async () => {
    rules = [{ name: 'r1', object_name: 'project', active: true }];
    await engine.fire('afterInsert', 'sys_sharing_rule', {});
    await engine.fire('afterUpdate', 'sys_sharing_rule', {});

    expect(engine.boundFor(RULE_REBIND_TRIGGER_PACKAGE)).toHaveLength(3);
  });

  it('keeps previous bindings and does not throw when listRules fails', async () => {
    rules = [{ name: 'r1', object_name: 'project', active: true }];
    await engine.fire('afterInsert', 'sys_sharing_rule', {});
    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE)).toHaveLength(2);

    ruleService.listRules = vi.fn(async () => { throw new Error('db gone'); });
    await expect(
      engine.fire('afterUpdate', 'sys_sharing_rule', {}),
    ).resolves.toBeUndefined(); // the write must not fail

    // The failed rebind ran before unbind — previous bindings intact.
    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE)).toHaveLength(2);
  });

  it('serializes overlapping rebinds so the newest rule snapshot wins', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let call = 0;
    ruleService.listRules = vi.fn(async () => {
      call++;
      if (call === 1) {
        await gate; // first rebind stalls on its read
        return [{ name: 'r1', object_name: 'alpha', active: true }];
      }
      return [{ name: 'r2', object_name: 'beta', active: true }];
    });

    const first = engine.fire('afterInsert', 'sys_sharing_rule', {});
    const second = engine.fire('afterUpdate', 'sys_sharing_rule', {});
    release();
    await Promise.all([first, second]);

    // The second (newest) snapshot is the one left bound.
    const bound = engine.boundFor(SHARING_RULE_HOOK_PACKAGE);
    expect(new Set(bound.map((h) => h.options.object))).toEqual(new Set(['beta']));
  });
});
