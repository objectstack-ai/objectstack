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
import { validateFlowTriggerReadiness } from './validate-flow-trigger-readiness.js';
import { validateListViewFieldRefs } from './validate-list-view-field-refs.js';

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
    // working. This one pins that the narrowed gate still FINDS things — at the
    // same rule and position. [#24669] Its severity is the one place it may
    // differ: under the closure an object found nowhere is outside it, so the
    // narrowed gate REFUSES what the whole-collection gate advises.
    const at = (r: { errors: AnyRec[]; advisories: AnyRec[] }) =>
      [...r.errors, ...r.advisories].map((f) => `${f.rule}|${f.path}`);
    const wholeRun = runRuntimeAuthoringRules({ type: 'flow', item: FLOW_INTO_GHOST, context: { objects } });
    const scopedRun = runRuntimeAuthoringRules({
      type: 'flow', item: FLOW_INTO_GHOST, context: { objects }, packageScope: SCOPE,
    });
    expect(whole('flow', FLOW_INTO_GHOST)).toHaveLength(1);
    expect(at(scopedRun)).toEqual(at(wholeRun));
    expect(wholeRun.advisories.map((f) => f.severity)).toEqual(['warning']);
    expect(scopedRun.errors.map((f) => f.severity)).toEqual(['error']);
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
    // the closure says so. [#24669] It REFUSES (`error`), the verdict the
    // dataset and view doors give the same reference; it used to advise.
    expect(whole('flow', FLOW_INTO_UNDECLARED)).toEqual([]);
    const narrowed = scoped('flow', FLOW_INTO_UNDECLARED);
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]).toContain('flow-trigger-unknown-object');
    const run = runRuntimeAuthoringRules({
      type: 'flow', item: FLOW_INTO_UNDECLARED, context: { objects }, packageScope: SCOPE,
    });
    expect(run.advisories).toEqual([]);
    expect(run.errors.map((f) => [f.rule, f.severity])).toEqual([['flow-trigger-unknown-object', 'error']]);
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

// ─────────────────────────────────────────────────────────────────────────────
// #24563 — the VIEW door under a package closure: a list view bound outside the
// closure is reported, never skipped; one bound inside keeps its field verdict.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A flattened list overlay — the shape `PUT /api/v1/meta/view` carries and the
 * gate snapshots as `views: [item]` — bound to `object` with one known
 * (`name`, every fixture object declares it) and optionally one unknown column.
 */
function listViewOn(object: string, columns: readonly string[] = ['name', 'zzz_nope']): AnyRec {
  return {
    name: `${object}.probe_list`,
    object,
    viewKind: 'list',
    label: 'Probe',
    type: 'grid',
    data: { provider: 'object', object },
    columns: columns.map((field) => ({ field })),
  };
}

describe('the view door under a package closure (#24563)', () => {
  const OUTSIDE = 'list-view-object-outside-closure';
  const FIELD_UNKNOWN = 'list-view-field-unknown';
  const objects = [...packagedTenant(3), obj('tenant_overlay', undefined)];
  const scoped = (item: AnyRec, scope: RuntimePackageScope = SCOPE) =>
    runRuntimeAuthoringRules({ type: 'view', item, context: { objects }, packageScope: scope });
  const whole = (item: AnyRec) => runRuntimeAuthoringRules({ type: 'view', item, context: { objects } });
  const rules = (fs: AnyRec[]) => fs.map((f) => f.rule);

  it('REFUSES a binding into a package the written one never declared — at the binding, with the remedy', () => {
    const result = scoped(listViewOn('other_0_0'));

    // An `error`, so the door refuses the write: the dataset door's verdict
    // for an out-of-closure base object under the same closure, and [#24669]
    // the flow door's `flow-trigger-unknown-object` (pinned above and below).
    expect(result.advisories).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ severity: 'error', rule: OUTSIDE });
    expect(result.errors[0].path).toMatch(/^views(\[0\]|\.other_0_0\.probe_list)\.data\.object$/);
    // The fix names the remedy and the package it applies to.
    expect(result.errors[0].hint).toContain(OWN);
    expect(result.errors[0].hint).toContain('dependencies');
    // ⛔ The field positions stay unjudged: judging them against the whole
    // collection would judge the package against what ruling #9612 says it may
    // not reference.
    expect(rules(result.errors)).not.toContain(FIELD_UNKNOWN);
  });

  it('REFUSES a binding to an object that exists nowhere the same way', () => {
    const result = scoped(listViewOn('nosuch_obj'));

    expect(result.advisories).toEqual([]);
    expect(rules(result.errors)).toEqual([OUTSIDE]);
  });

  it('REFUSES it under a closure that carries no object at all — an empty graph is still a verdict', () => {
    const result = runRuntimeAuthoringRules({
      type: 'view',
      item: listViewOn('nosuch_obj'),
      context: { objects: [] },
      packageScope: SCOPE,
    });

    expect(rules(result.errors)).toEqual([OUTSIDE]);
  });

  it('REFUSES an unknown column on an object of the written package — the field verdict is unchanged', () => {
    const result = scoped(listViewOn('crm_account'));

    expect(rules(result.errors)).toEqual([FIELD_UNKNOWN]);
    expect(result.errors[0].path).toMatch(/columns\[1\]\.field$/);
    expect(result.advisories).toEqual([]);
  });

  it('admits a known column on an object of the written package', () => {
    const result = scoped(listViewOn('crm_account', ['name']));

    expect(result.errors).toEqual([]);
    expect(result.advisories).toEqual([]);
  });

  it('keeps a DECLARED DEPENDENCY inside the closure — known column admitted, unknown refused', () => {
    // The discriminating case: a refusal of the binding here would mean the
    // dependency limb never reached the rule.
    expect(scoped(listViewOn('core_user', ['name']))).toMatchObject({ errors: [], advisories: [] });
    expect(rules(scoped(listViewOn('core_user')).errors)).toEqual([FIELD_UNKNOWN]);
  });

  it('keeps system objects inside the closure — by name prefix and by isSystem flag', () => {
    for (const name of ['sys_audit_log', 'platform_ledger']) {
      expect(scoped(listViewOn(name, ['name'])), name).toMatchObject({ errors: [], advisories: [] });
      expect(rules(scoped(listViewOn(name)).errors), name).toEqual([FIELD_UNKNOWN]);
    }
  });

  it('keeps a provenance-less overlay object inside the closure — its field verdict is unchanged', () => {
    expect(rules(scoped(listViewOn('tenant_overlay')).errors)).toEqual([FIELD_UNKNOWN]);
    expect(scoped(listViewOn('tenant_overlay')).advisories).toEqual([]);
  });

  it('a write that names no package is unchanged — the whole collection, field verdict and silence alike', () => {
    // ⛔ The overlay door: the stranger's object is in the whole collection, so
    // its unknown column is refused exactly as before, and an object that
    // exists nowhere stays skip 1's silence (no scope, so no closure verdict).
    expect(rules(whole(listViewOn('other_0_0')).errors)).toEqual([FIELD_UNKNOWN]);
    expect(whole(listViewOn('other_0_0')).advisories).toEqual([]);
    expect(whole(listViewOn('nosuch_obj'))).toMatchObject({ errors: [], advisories: [] });
    // An empty package id narrows nothing, so it states no closure either.
    const empty = { packageId: '', dependencies: [] } as RuntimePackageScope;
    expect(scoped(listViewOn('nosuch_obj'), empty)).toMatchObject({ errors: [], advisories: [] });
  });

  it('the flow verdict is the closure\'s, and a stored object\'s out-of-closure list view is not charged to it', () => {
    // A context object of the written package whose built-in list view
    // retargets an object outside the closure: the rule now refuses that list
    // view, in the baseline and the candidate alike, so it cancels — a flow
    // publish is not refused for a stored sibling's binding (#4463 D4).
    const retargeting = obj('crm_board', OWN, {
      listViews: { foreign: { label: 'Foreign', data: { provider: 'object', object: 'other_0_0' }, columns: ['name'] } },
    });
    const withSibling = [...objects, retargeting];
    const flow = (item: AnyRec) =>
      verdict(runRuntimeAuthoringRules({ type: 'flow', item, context: { objects: withSibling }, packageScope: SCOPE }));

    // Non-vacuous: written itself, that object IS refused — the list view
    // rides the object door too, at the same verdict.
    const asWritten = runRuntimeAuthoringRules({ type: 'object', item: retargeting, context: { objects }, packageScope: SCOPE });
    expect(rules(asWritten.errors)).toContain(OUTSIDE);
    expect(rules(asWritten.advisories)).not.toContain(OUTSIDE);

    expect(flow(FLOW_INTO_OWN_PACKAGE)).toEqual([]);
    const undeclared = flow(FLOW_INTO_UNDECLARED);
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]).toContain('flow-trigger-unknown-object');
    // [#24669] Refused, not advised: the flow's own trigger object is outside
    // the closure. The stored sibling's list view still cancels.
    const run = runRuntimeAuthoringRules({
      type: 'flow', item: FLOW_INTO_UNDECLARED, context: { objects: withSibling }, packageScope: SCOPE,
    });
    expect(run.errors.map((f) => f.rule)).toEqual(['flow-trigger-unknown-object']);
    expect(run.advisories).toEqual([]);
  });

  it('the CLI reading is unchanged: no scope stated, skip 1 judges nothing', () => {
    // `os validate` / `os build` / `os lint` hand the rule no closure.
    expect(validateListViewFieldRefs({ objects, views: [listViewOn('nosuch_obj')] })).toEqual([]);
    // And the same stack under a stated closure is the verdict above.
    expect(
      validateListViewFieldRefs(
        { objects, views: [listViewOn('nosuch_obj')] },
        { packageScope: SCOPE },
      ).map((f) => f.rule),
    ).toEqual([OUTSIDE]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #24669 — the FLOW door under a package closure: a trigger object outside the
// closure is refused, at both positions the rule reads; one inside it, a
// platform object and a `sys_` name are admitted; with no closure stated the
// advisory is byte-identical to the CLI's.
// ─────────────────────────────────────────────────────────────────────────────

/** A daily time-relative sweep over `object` — the rule's second position. */
function sweepOf(name: string, object: string): AnyRec {
  return {
    name,
    label: name,
    status: 'active',
    type: 'schedule',
    runAs: 'system',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'Daily sweep',
        config: { timeRelative: { object, dateField: 'name', withinDays: 7 } },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end', type: 'default', isDefault: false }],
  };
}

describe('the flow door under a package closure (#24669)', () => {
  const UNKNOWN = 'flow-trigger-unknown-object';
  const objects = [
    ...packagedTenant(3),
    obj('tenant_overlay', undefined),
    obj('stranger_flagged', STRANGER, { isSystem: true }),
  ];
  const run = (item: AnyRec, scope?: RuntimePackageScope) =>
    runRuntimeAuthoringRules({
      type: 'flow',
      item,
      context: { objects },
      ...(scope !== undefined ? { packageScope: scope } : {}),
    });
  const of = (fs: AnyRec[]) => fs.filter((f) => f.rule === UNKNOWN);
  /** The two positions, each as (flow body, the finding path's tail). */
  const positions: Array<[string, (object: string) => AnyRec, string]> = [
    ['config.objectName', (o) => flowOn(`on_${o}`, o), 'config.objectName'],
    ['config.timeRelative.object', (o) => sweepOf(`sweep_${o}`, o), 'config.timeRelative.object'],
  ];

  for (const [label, body, tail] of positions) {
    it(`REFUSES an object of a package the written one never declared — ${label}`, () => {
      const result = run(body('other_0_0'), SCOPE);
      expect(of(result.advisories)).toEqual([]);
      expect(of(result.errors)).toHaveLength(1);
      const [f] = of(result.errors);
      expect(f).toMatchObject({ severity: 'error', rule: UNKNOWN });
      expect(f.path.endsWith(tail)).toBe(true);
      // The fix names the remedy and the package it applies to.
      expect(f.hint).toContain(OWN);
      expect(f.hint).toContain('dependencies');
      expect(f.hint).toContain(tail);
      expect(f.message).toContain("'other_0_0'");
      expect(f.message).toContain(OWN);
    });

    it(`REFUSES an object that exists nowhere — the closure is all the snapshot sees — ${label}`, () => {
      const result = run(body('ghost_object'), SCOPE);
      expect(of(result.errors).map((f) => f.severity)).toEqual(['error']);
      expect(of(result.advisories)).toEqual([]);
    });

    it(`admits the own package, a declared dependency, platform objects and overlay rows — ${label}`, () => {
      for (const target of [
        'crm_account', // the written package
        'core_user', // its declared dependency
        'platform_ledger', // a platform object by `isSystem`
        'stranger_flagged', // `isSystem` although a stranger package owns it
        'sys_audit_log', // a platform object by prefix, carried
        'sys_never_carried', // a `sys_` name the snapshot does not carry: unjudged, as without a closure
        'tenant_overlay', // a provenance-less overlay row
      ]) {
        const result = run(body(target), SCOPE);
        expect([...of(result.errors), ...of(result.advisories)], target).toEqual([]);
      }
    });

    it(`a write that names no package keeps the advisory, byte-identical to the CLI's — ${label}`, () => {
      // The stranger's object is in the whole collection, so it is not
      // unknown at all; an object that exists nowhere is ADVISED, not refused.
      expect(of([...run(body('other_0_0')).errors, ...run(body('other_0_0')).advisories])).toEqual([]);
      const advised = run(body('ghost_object'));
      expect(of(advised.errors)).toEqual([]);
      expect(of(advised.advisories)).toHaveLength(1);
      const cli = validateFlowTriggerReadiness({ objects, flows: [body('ghost_object')] })
        .filter((f) => f.rule === UNKNOWN);
      expect(cli).toHaveLength(1);
      expect(cli[0]!.severity).toBe('warning');
      const [door] = of(advised.advisories);
      expect({ severity: door.severity, message: door.message, hint: door.hint }).toEqual({
        severity: cli[0]!.severity,
        message: cli[0]!.message,
        hint: cli[0]!.hint,
      });
      // An empty package id narrows nothing, so it states no closure either.
      const empty = { packageId: '', dependencies: [] } as RuntimePackageScope;
      expect(of(run(body('ghost_object'), empty).errors)).toEqual([]);
      expect(of(run(body('ghost_object'), empty).advisories)).toHaveLength(1);
    });
  }

  it('the CLI reading is unchanged: no scope stated, the advisory the rule always gave', () => {
    // `os validate` / `os build` / `os lint` hand the rule no closure.
    const [f] = validateFlowTriggerReadiness({ objects: [], flows: [flowOn('cli_probe', 'ghost_object')] });
    expect(f).toMatchObject({ severity: 'warning', rule: UNKNOWN });
    expect(f!.hint).toContain('ignore this if another installed package declares it');
    // And the same stack under a stated closure is the verdict above.
    const [g] = validateFlowTriggerReadiness(
      { objects: [], flows: [flowOn('cli_probe', 'ghost_object')] },
      { packageScope: SCOPE },
    );
    expect(g).toMatchObject({ severity: 'error', rule: UNKNOWN });
  });
});
