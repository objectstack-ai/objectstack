// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9612 — the publish gate judges a write against its PACKAGE's closure.
 *
 * The maintainer's ruling is the product decision under test, verbatim:
 *
 * > 大客户(420 个对象),就不应该出现在一个软件包中啊,这就是划分软件包的价值。
 * > 客户开发开发,校验是否也应该基于软件包
 * > 当然这里面要考虑系统对象
 *
 * So this file is NOT a performance test. It pins the four limbs of the
 * closure, the fallback direction when a package cannot be resolved, and — the
 * part that matters — that narrowing does not change the gate's ANSWER.
 *
 * ## Why the equivalence assertions are paired with ablations
 *
 * "The verdict is unchanged" is worth nothing from a fixture where nothing
 * could have changed it. Measured on the shipped rules: the OBJECT door has no
 * objects×objects coupling at all — none of its seven rules builds a
 * name→object index — so on that door a verdict-equivalence assertion passes
 * for a reason that has nothing to do with the closure being right. The FLOW
 * door does have the coupling, and that is where the ablations below live: drop
 * the written item's own package and a phantom reference finding appears; drop
 * system objects and real findings disappear. Both directions are asserted, so
 * an equivalence test that stopped being able to fail would be caught here
 * rather than read as a pass.
 */
import { describe, expect, it } from 'vitest';
import {
  narrowObjectsToPackageClosure,
  runRuntimeAuthoringRules,
  type RuntimePackageScope,
} from './runtime-gate.js';

type AnyRec = Record<string, any>;

const OWN = 'com.acme.crm';
const DEP = 'com.acme.core';
const STRANGER = 'com.other.analytics';
const PLATFORM = 'com.objectstack.platform';

const SCOPE: RuntimePackageScope = { packageId: OWN, dependencies: [DEP] };

/** A minimal, spec-shaped object declaration. */
function obj(name: string, packageId?: string | null, extra: AnyRec = {}): AnyRec {
  return {
    name,
    label: name,
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
    ...(packageId === undefined ? {} : { _packageId: packageId }),
    ...extra,
  };
}

describe('narrowObjectsToPackageClosure — the four limbs (#9612)', () => {
  const collection = [
    obj('crm_account', OWN),
    obj('core_user', DEP),
    obj('analytics_cube', STRANGER),
    obj('sys_audit_log', PLATFORM),
    obj('tenant_overlay', undefined),
    obj('rehydrated_overlay', 'sys_metadata'),
    obj('flagged_system', STRANGER, { isSystem: true }),
  ];
  const kept = () =>
    (narrowObjectsToPackageClosure(collection, SCOPE) as AnyRec[]).map((o) => o.name);

  it('keeps the written package and its declared dependency', () => {
    expect(kept()).toContain('crm_account');
    expect(kept()).toContain('core_user');
  });

  it('drops a package that is neither the written one nor a declared dependency', () => {
    expect(kept()).not.toContain('analytics_cube');
  });

  it('keeps system objects unconditionally — by name prefix AND by isSystem flag', () => {
    // The card's named hazard: a package references a platform object it never
    // declares a dependency on. Judged against a closure that omitted it, the
    // gate would report an unresolved reference that is not there.
    expect(kept()).toContain('sys_audit_log');
    expect(kept()).toContain('flagged_system');
  });

  it('keeps unpackaged rows, including the `sys_metadata` rehydration sentinel', () => {
    // Nothing declares what a tenant-authored overlay row may reference, so
    // nothing bounds it. Keeping it is the conservative direction.
    expect(kept()).toContain('tenant_overlay');
    expect(kept()).toContain('rehydrated_overlay');
  });

  it('narrows NOTHING when no scope is stated', () => {
    expect(narrowObjectsToPackageClosure(collection, undefined)).toBe(collection);
  });

  it('narrows NOTHING when the scope carries an empty package id', () => {
    // The host returns `undefined` rather than an empty id, but the guard is
    // here too: an unresolvable package must buy MORE validation input, never
    // less. ⛔ There is no branch anywhere that skips rules or skips them past
    // a size — that is the fail-open at scale this card was forbidden to build.
    const empty = { packageId: '', dependencies: [] } as RuntimePackageScope;
    expect(narrowObjectsToPackageClosure(collection, empty)).toBe(collection);
  });

  it('keeps a non-object member rather than inspecting it', () => {
    const ragged = [null, 'not-an-object', obj('analytics_cube', STRANGER)];
    expect(narrowObjectsToPackageClosure(ragged, SCOPE)).toEqual([null, 'not-an-object']);
  });

  it('follows the dependency set the host resolved, not a graph of its own', () => {
    // The transitive walk lives in the host (it holds the package registry).
    // This function reads the set it is given and must not try to extend it.
    const transitive: RuntimePackageScope = { packageId: OWN, dependencies: [DEP, STRANGER] };
    const names = (narrowObjectsToPackageClosure(collection, transitive) as AnyRec[]).map((o) => o.name);
    expect(names).toContain('analytics_cube');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The gate's ANSWER under narrowing — flow door, where objects×objects coupling
// actually exists.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A flow that fires on a record trigger against `objectName`.
 *
 * The shape is the shipped one (`nodes[0].type: 'start'`, the object named in
 * `config.objectName`) — that is what `flow-trigger-unknown-object` reads, and
 * a fixture in any other shape produces no findings at all and would make every
 * assertion in this file pass vacuously.
 */
function flowOn(name: string, objectName: string): AnyRec {
  return {
    name,
    label: name,
    status: 'active',
    type: 'autolaunched',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'On update',
        config: { objectName, triggerType: 'record-after-update' },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end', type: 'default', isDefault: false }],
  };
}

/** Targets an object in the written package — resolves under the closure. */
const FLOW_INTO_OWN_PACKAGE = flowOn('crm_account_touched', 'crm_account');
/**
 * Targets a PLATFORM object no package declares — the card's named hazard.
 *
 * `platform_ledger` rather than `sys_audit_log` on purpose:
 * `validateFlowTriggerReadiness` exempts any target whose NAME starts with
 * `sys_` (its own header calls such targets legitimate), so a `sys_`-named
 * fixture would make the ablation below unable to fail for a reason that has
 * nothing to do with the closure. `platform_ledger` carries `isSystem: true`
 * instead — the OTHER limb of the same predicate — so the rule still judges it
 * while the closure still keeps it.
 */
const FLOW_INTO_SYSTEM_OBJECT = flowOn('platform_ledger_touched', 'platform_ledger');
/** Targets an object that exists in NO package — a genuine finding, always. */
const FLOW_INTO_GHOST = flowOn('ghost_touched', 'ghost_object');
/** Targets a package the written one does NOT declare a dependency on. */
const FLOW_INTO_UNDECLARED = flowOn('stranger_touched', 'other_0_0');

/** A tenant of many packages — the shape the ruling says a big tenant really is. */
function packagedTenant(strangerPackages: number): AnyRec[] {
  const out: AnyRec[] = [
    obj('crm_account', OWN),
    obj('crm_contact', OWN),
    obj('core_user', DEP),
    obj('sys_audit_log', PLATFORM),
    obj('platform_ledger', PLATFORM, { isSystem: true }),
  ];
  for (let i = 0; i < strangerPackages; i++) {
    for (let k = 0; k < 5; k++) out.push(obj(`other_${i}_${k}`, `com.other.pkg_${i}`));
  }
  return out;
}

/** Every finding the write ADDED, as stable text. Array indices normalised. */
function verdict(result: { errors: AnyRec[]; advisories: AnyRec[] }): string[] {
  return [...result.errors, ...result.advisories]
    .map((f) => `${f.rule}|${f.where}|${String(f.path ?? '').replace(/\[\d+\]/g, '[i]')}|${f.message}`)
    .sort();
}

describe('the differential verdict survives package narrowing (#9612)', () => {
  const objects = packagedTenant(20);
  const scoped = (type: string, item: AnyRec) =>
    verdict(runRuntimeAuthoringRules({ type, item, context: { objects }, packageScope: SCOPE }));
  const whole = (type: string, item: AnyRec) =>
    verdict(runRuntimeAuthoringRules({ type, item, context: { objects } }));

  it('a REAL finding survives narrowing — the equivalence is not vacuous', () => {
    // Asserted first and by content: every other case in this block compares
    // two empty verdicts, which would also be equal if the gate had stopped
    // working. This one pins that the narrowed gate still FINDS things.
    expect(whole('flow', FLOW_INTO_GHOST)).toHaveLength(1);
    expect(scoped('flow', FLOW_INTO_GHOST)).toEqual(whole('flow', FLOW_INTO_GHOST));
  });

  it('reaches the whole-stack answer exactly for a flow into its own package', () => {
    expect(scoped('flow', FLOW_INTO_OWN_PACKAGE)).toEqual(whole('flow', FLOW_INTO_OWN_PACKAGE));
    expect(whole('flow', FLOW_INTO_OWN_PACKAGE)).toEqual([]);
  });

  it('reaches the whole-stack answer exactly for a flow into a PLATFORM object', () => {
    // The closure keeps `sys_audit_log` although no package declares it. The
    // ablation below is what proves this assertion could have failed.
    expect(scoped('flow', FLOW_INTO_SYSTEM_OBJECT)).toEqual(whole('flow', FLOW_INTO_SYSTEM_OBJECT));
    expect(whole('flow', FLOW_INTO_SYSTEM_OBJECT)).toEqual([]);
  });

  it('reaches the whole-stack answer exactly, object door', () => {
    const written = obj('crm_opportunity', OWN, {
      validations: [
        { name: 'shape', type: 'json_schema', schema: { type: 'not-a-type' }, message: 'bad' },
      ],
    });
    // Non-vacuous in the same way: the broken schema is a finding the narrowed
    // gate must still produce.
    expect(whole('object', written).length).toBeGreaterThan(0);
    expect(scoped('object', written)).toEqual(whole('object', written));
  });

  it('narrows nothing — byte-identical to the pre-#9612 gate — with no scope', () => {
    const written = obj('crm_opportunity', OWN);
    const before = runRuntimeAuthoringRules({ type: 'object', item: written, context: { objects } });
    const after = runRuntimeAuthoringRules({
      type: 'object',
      item: written,
      context: { objects },
      packageScope: undefined,
    });
    expect(verdict(after)).toEqual(verdict(before));
  });

  it('DOES judge a reference outside the declared dependencies — the ruling\'s intended consequence', () => {
    // ⭐ The one place the answer legitimately differs, pinned so it is a
    // decision on the record rather than a surprise. A package's declared
    // `dependencies` bound what it MAY reference; a flow reaching into a
    // package this one never declared is not resolvable BY DECLARATION, and
    // the closure says so. Measured severity here is advisory (`warning`), so
    // it reports rather than refuses.
    expect(whole('flow', FLOW_INTO_UNDECLARED)).toEqual([]);
    const narrowed = scoped('flow', FLOW_INTO_UNDECLARED);
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]).toContain('flow-trigger-unknown-object');
  });
});

describe('ablations — the equivalence assertions above can fail (#9612)', () => {
  const objects = packagedTenant(20);

  it('DROPPING the written package manufactures a phantom the closure prevents', () => {
    // The #7886 mechanism reproduced on `objects` rather than `permissions`.
    // ⭐ #7886's phantoms came from narrowing `permissions`; the PM's original
    // premise that narrowing PER SE manufactures them was falsified on #9612.
    // What manufactures them is a closure missing a limb — this one.
    const broken = objects.filter((o) => o._packageId !== OWN);
    const mutilated = verdict(
      runRuntimeAuthoringRules({ type: 'flow', item: FLOW_INTO_OWN_PACKAGE, context: { objects: broken } }),
    );
    expect(mutilated).toHaveLength(1);
    expect(mutilated[0]).toContain('flow-trigger-unknown-object');
  });

  it('DROPPING system objects changes the answer — which is why that limb is unconditional', () => {
    const broken = objects.filter((o) => o.isSystem !== true && !String(o.name).startsWith('sys_'));
    const mutilated = verdict(
      runRuntimeAuthoringRules({ type: 'flow', item: FLOW_INTO_SYSTEM_OBJECT, context: { objects: broken } }),
    );
    expect(mutilated).toHaveLength(1);
    expect(mutilated[0]).toContain('flow-trigger-unknown-object');
  });
});
