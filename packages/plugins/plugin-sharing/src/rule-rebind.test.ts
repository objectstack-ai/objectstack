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
      evaluateRule: vi.fn(async () => ({ ruleId: 'r1', matchedRecords: 0, expandedUsers: 0, grantsCreated: 0, grantsUpdated: 0, grantsRevoked: 0 })),
      revokeRuleGrants: vi.fn(async () => 0),
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

/**
 * objectstack#3821 — rebinding alone only makes a rule apply to records written
 * from now on. A rule authored in Setup did nothing to the records already
 * there, and one switched OFF (or deleted) kept every grant it had issued —
 * boot backfill only reconciles ACTIVE rules, so those grants outlived
 * restarts while the UI showed the rule as disabled.
 */
describe('SharingServicePlugin reconciles grants on rule writes (#3821)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let plugin: SharingServicePlugin;
  let ruleService: AnyRecord;
  let logger: AnyRecord;

  beforeEach(() => {
    engine = makeEngine();
    plugin = new SharingServicePlugin();
    ruleService = {
      listRules: vi.fn(async () => []),
      evaluateRule: vi.fn(async () => ({ ruleId: 'r1', matchedRecords: 2, expandedUsers: 1, grantsCreated: 2, grantsUpdated: 0, grantsRevoked: 0 })),
      revokeRuleGrants: vi.fn(async () => 2),
      sweepOrphanedRuleGrants: vi.fn(async () => 0),
    };
    (plugin as any).ruleService = ruleService;
    const ctx = makeCtx();
    logger = ctx.logger;
    (plugin as any).bindRuleRebindTriggers(engine, ctx);
    // [#4433] Boot is over — `kernel:bootstrapped` has run its backfill, so
    // runtime rule writes own reconciliation from here. Before this point the
    // trigger defers to that pass (see the boot-phase describe below).
    (plugin as any).ruleGrantsBootReconciled = true;
  });

  it('backfills existing records when a rule is created', async () => {
    await engine.fire('afterInsert', 'sys_sharing_rule', { result: { id: 'r1' } });
    expect(ruleService.evaluateRule).toHaveBeenCalledWith('r1', expect.objectContaining({ isSystem: true }));
  });

  it('reconciles on update — this is what withdraws access when a rule is switched off', async () => {
    // `evaluateRule` purges the grants itself when the rule is inactive, so the
    // plugin does not need to branch on `active` here.
    await engine.fire('afterUpdate', 'sys_sharing_rule', { result: { id: 'r1', active: false } });
    expect(ruleService.evaluateRule).toHaveBeenCalledWith('r1', expect.objectContaining({ isSystem: true }));
  });

  it('purges grants on delete rather than evaluating a row that no longer exists', async () => {
    await engine.fire('afterDelete', 'sys_sharing_rule', { input: { id: 'r1' } });
    expect(ruleService.revokeRuleGrants).toHaveBeenCalledWith('r1');
    expect(ruleService.evaluateRule).not.toHaveBeenCalled();
  });

  /**
   * objectstack#4433 — this is the defect, and it hid behind the test that
   * used to live here ("skips system-context writes").
   *
   * `SharingRuleService.defineRule` — the ONLY implementation behind
   * `POST /sharing/rules`, the documented way to deactivate a rule — writes
   * `sys_sharing_rule` with SYSTEM_CTX unconditionally, because it has to
   * reach a platform table the sharing middleware otherwise gates. So the old
   * `session.isSystem` skip did not filter out "boot seeding"; it filtered out
   * every REST authoring write there is. The old test passed a mocked
   * `session: { isSystem: true }` that the real REST path never sends, and
   * asserted the reconcile did NOT happen — pinning the bug as the contract.
   */
  it('reconciles a SYSTEM_CTX authoring write once boot is done (#4433)', async () => {
    // Exactly what `POST /sharing/rules` with `active: false` produces.
    await engine.fire('afterUpdate', 'sys_sharing_rule', {
      result: { id: 'r1', active: false },
      session: { isSystem: true },
    });
    expect(ruleService.evaluateRule).toHaveBeenCalledWith('r1', expect.objectContaining({ isSystem: true }));
  });

  it('never fails the authoring write when reconciliation throws', async () => {
    ruleService.evaluateRule = vi.fn(async () => { throw new Error('db gone'); });
    await expect(
      engine.fire('afterUpdate', 'sys_sharing_rule', { result: { id: 'r1' } }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does nothing when the write carries no rule id', async () => {
    await engine.fire('afterUpdate', 'sys_sharing_rule', {});
    expect(ruleService.evaluateRule).not.toHaveBeenCalled();
    expect(ruleService.revokeRuleGrants).not.toHaveBeenCalled();
  });

  it('serializes reconciles behind the rebind chain', async () => {
    const order: string[] = [];
    ruleService.listRules = vi.fn(async () => { order.push('rebind'); return []; });
    ruleService.evaluateRule = vi.fn(async () => { order.push('reconcile'); return {} as any; });

    await engine.fire('afterInsert', 'sys_sharing_rule', { result: { id: 'r1' } });

    expect(order).toEqual(['rebind', 'reconcile']);
  });
});

/**
 * [#4433] Boot phase — the predicate that replaced the `isSystem` skip.
 *
 * The skip exists to avoid duplicating work: declared-rule seeding and package
 * bootstrap write `sys_sharing_rule` before `kernel:bootstrapped`, and that
 * pass reconciles every rule anyway. That is a statement about WHEN a write
 * happens, not about WHO made it — so it is gated on boot phase, which is true
 * for exactly the writes the backfill covers and false for every runtime one.
 */
describe('SharingServicePlugin defers reconciliation to the boot backfill (#4433)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let plugin: SharingServicePlugin;
  let ruleService: AnyRecord;

  beforeEach(() => {
    engine = makeEngine();
    plugin = new SharingServicePlugin();
    ruleService = {
      listRules: vi.fn(async () => []),
      evaluateRule: vi.fn(async () => ({ ruleId: 'r1', matchedRecords: 0, expandedUsers: 0, grantsCreated: 0, grantsUpdated: 0, grantsRevoked: 0 })),
      revokeRuleGrants: vi.fn(async () => 0),
      sweepOrphanedRuleGrants: vi.fn(async () => 0),
    };
    (plugin as any).ruleService = ruleService;
    (plugin as any).bindRuleRebindTriggers(engine, makeCtx());
    // Boot still in flight — `ruleGrantsBootReconciled` defaults to false.
  });

  it('skips the per-write reconcile while boot is still in flight', async () => {
    await engine.fire('afterInsert', 'sys_sharing_rule', { result: { id: 'seeded' } });
    expect(ruleService.evaluateRule).not.toHaveBeenCalled();
  });

  it('still rebinds the lifecycle hooks during boot', async () => {
    // Deferring the reconcile must not defer the binding — a rule seeded at
    // boot has to be enforceable for records written straight afterwards.
    await engine.fire('afterInsert', 'sys_sharing_rule', { result: { id: 'seeded' } });
    expect(ruleService.listRules).toHaveBeenCalled();
  });

  it('reconciles every write once the backfill has run — user session', async () => {
    (plugin as any).ruleGrantsBootReconciled = true;
    await engine.fire('afterUpdate', 'sys_sharing_rule', {
      result: { id: 'r1', active: false },
      session: { userId: 'admin' },
    });
    expect(ruleService.evaluateRule).toHaveBeenCalledWith('r1', expect.objectContaining({ isSystem: true }));
  });

  it('reconciles every write once the backfill has run — system session', async () => {
    (plugin as any).ruleGrantsBootReconciled = true;
    await engine.fire('afterUpdate', 'sys_sharing_rule', {
      result: { id: 'r1', active: false },
      session: { isSystem: true },
    });
    expect(ruleService.evaluateRule).toHaveBeenCalledWith('r1', expect.objectContaining({ isSystem: true }));
  });

  it('purges on a post-boot delete regardless of session kind', async () => {
    (plugin as any).ruleGrantsBootReconciled = true;
    await engine.fire('afterDelete', 'sys_sharing_rule', {
      input: { id: 'r1' },
      session: { isSystem: true },
    });
    expect(ruleService.revokeRuleGrants).toHaveBeenCalledWith('r1');
  });
});
