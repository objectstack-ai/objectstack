// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24668 — the VIEW door against the WHOLE collection: a runtime write that
 * names no package (an overlay write) of a list view bound to an object that
 * exists nowhere is REFUSED `list-view-object-unknown`, once, at the binding.
 *
 * The overlay twin of #24563 (`runtime-gate.package-closure.test.ts`, the
 * closure verdict). With no closure in force the gate hands the rules every
 * object the host serves, so a binding missing from it exists nowhere — there
 * is no other package for it to come from. What these pins hold:
 *
 *  - the refusal itself, on every rung the rule walks, at the binding key;
 *  - a binding that resolves keeps its field verdict exactly;
 *  - the CLI (`os validate` / `os build` / `os lint`) keeps skip 1 — its stack
 *    is one app, and an unresolved binding may be a dependency's object;
 *  - an EMPTY collection is no universe, so nothing is judged;
 *  - a closure wins over the whole-collection statement;
 *  - the differential charges a write only with its own finding: a stored
 *    sibling's dangling binding cancels, including when the write creates the
 *    object nearest to it (the suggestion rides the hint, not the message).
 *
 * Drafts are not a lint-layer concept: the draft door is pinned where it
 * lives, in `packages/metadata-protocol` (`protocol.runtime-authoring-gate.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';
import { runRuntimeAuthoringRules, type RuntimePackageScope } from './runtime-gate.js';
import {
  LIST_VIEW_FIELD_UNKNOWN,
  LIST_VIEW_OBJECT_OUTSIDE_CLOSURE,
  LIST_VIEW_OBJECT_UNKNOWN,
  validateListViewFieldRefs,
} from './validate-list-view-field-refs.js';

type AnyRec = Record<string, any>;

const OWN = 'com.acme.crm';
const STRANGER = 'com.other.analytics';
const PLATFORM = 'com.objectstack.platform';

/** A minimal, spec-shaped object declaration (every one declares `name`). */
function obj(name: string, packageId?: string, extra: AnyRec = {}): AnyRec {
  return {
    name,
    label: name,
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
    ...(packageId === undefined ? {} : { _packageId: packageId }),
    ...extra,
  };
}

/** The whole collection a host serves: two packages, a platform object, a provenance-less overlay row. */
const OBJECTS: readonly AnyRec[] = [
  obj('crm_account', OWN),
  obj('showcase_task', STRANGER),
  obj('sys_audit_log', PLATFORM),
  obj('tenant_overlay'),
];

/**
 * The card's body: a flattened list overlay — the shape `PUT /api/v1/meta/view`
 * carries — bound to `object`, one known and by default one unknown column.
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

const overlay = (item: AnyRec, objects: readonly AnyRec[] = OBJECTS) =>
  runRuntimeAuthoringRules({ type: 'view', item, context: { objects } });
const rules = (fs: readonly AnyRec[]) => fs.map((f) => f.rule);

describe('the view door against the whole collection (#24668)', () => {
  it('REFUSES a binding to an object that exists nowhere — once, at the binding, positions unjudged', () => {
    const result = overlay(listViewOn('nosuch_obj'));

    expect(result.advisories).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ severity: 'error', rule: LIST_VIEW_OBJECT_UNKNOWN });
    expect(result.errors[0].path).toMatch(/^views(\[0\]|\.nosuch_obj\.probe_list)\.data\.object$/);
    expect(result.errors[0].message).toContain('"nosuch_obj"');
    // ⛔ One finding per list view: the unknown column is not judged against
    // an object there is no field map for.
    expect(rules(result.errors)).not.toContain(LIST_VIEW_FIELD_UNKNOWN);
  });

  it('names the nearest object in the HINT, and leaves the message free of it', () => {
    const result = overlay(listViewOn('crm_acount'));

    expect(rules(result.errors)).toEqual([LIST_VIEW_OBJECT_UNKNOWN]);
    expect(result.errors[0].hint).toContain('Did you mean "crm_account"?');
    expect(result.errors[0].message).not.toContain('crm_account"');
  });

  it('refuses on every rung the rule walks, each at the key the binding was read from', () => {
    const rungs: Array<[string, AnyRec, RegExp]> = [
      ['container `list`', { name: 'board', object: 'nosuch_obj', list: { type: 'grid', columns: [{ field: 'name' }] } }, /\.objectName$|\.object$/],
      ['container `list.data.object`', { name: 'board', object: 'crm_account', list: { type: 'grid', data: { provider: 'object', object: 'nosuch_obj' }, columns: [{ field: 'name' }] } }, /\.list\.data\.object$/],
      ['container `listViews.*`', { name: 'board', object: 'crm_account', listViews: { all: { type: 'grid', data: { provider: 'object', object: 'nosuch_obj' }, columns: [{ field: 'name' }] } } }, /\.listViews\.all\.data\.object$/],
      ['ViewItem record', { name: 'board', object: 'nosuch_obj', viewKind: 'list', config: { type: 'grid', columns: [{ field: 'name' }] } }, /\.object$/],
    ];
    for (const [label, item, path] of rungs) {
      const result = overlay(item);
      expect(rules(result.errors), label).toEqual([LIST_VIEW_OBJECT_UNKNOWN]);
      expect(result.errors[0].path, label).toMatch(path);
      expect(result.advisories, label).toEqual([]);
    }
  });

  it('refuses an OBJECT write whose built-in list view retargets an object that exists nowhere', () => {
    const item = obj('crm_board', undefined, {
      listViews: { foreign: { label: 'Foreign', data: { provider: 'object', object: 'nosuch_obj' }, columns: ['name'] } },
    });
    const result = runRuntimeAuthoringRules({ type: 'object', item, context: { objects: OBJECTS } });

    expect(rules(result.errors)).toEqual([LIST_VIEW_OBJECT_UNKNOWN]);
    expect(result.errors[0].path).toMatch(/listViews\.foreign\.data\.object$/);
  });

  it('a binding that RESOLVES keeps its field verdict — package, stranger, platform and overlay objects alike', () => {
    for (const bound of ['crm_account', 'showcase_task', 'sys_audit_log', 'tenant_overlay']) {
      expect(overlay(listViewOn(bound, ['name'])), bound).toMatchObject({ errors: [], advisories: [] });
      const refused = overlay(listViewOn(bound));
      expect(rules(refused.errors), bound).toEqual([LIST_VIEW_FIELD_UNKNOWN]);
      expect(refused.errors[0].path, bound).toMatch(/columns\[1\]\.field$/);
      expect(refused.advisories, bound).toEqual([]);
    }
  });

  it('an EMPTY collection is no universe: nothing is judged, exactly as before', () => {
    expect(overlay(listViewOn('nosuch_obj'), [])).toMatchObject({ errors: [], advisories: [] });
    expect(runRuntimeAuthoringRules({ type: 'view', item: listViewOn('nosuch_obj') }))
      .toMatchObject({ errors: [], advisories: [] });
  });

  it('a closure wins: the same body written into a package is the #24563 verdict, not this one', () => {
    const scope: RuntimePackageScope = { packageId: OWN, dependencies: [] };
    const result = runRuntimeAuthoringRules({ type: 'view', item: listViewOn('nosuch_obj'), context: { objects: OBJECTS }, packageScope: scope });

    expect(rules(result.errors)).toEqual([LIST_VIEW_OBJECT_OUTSIDE_CLOSURE]);
    // And at the rule itself, when a caller states both.
    expect(
      validateListViewFieldRefs(
        { objects: OBJECTS, views: [listViewOn('nosuch_obj')] },
        { packageScope: scope, wholeCollection: true },
      ).map((f) => f.rule),
    ).toEqual([LIST_VIEW_OBJECT_OUTSIDE_CLOSURE]);
  });

  it('a stored sibling\'s dangling binding is not charged to a flow write', () => {
    const dangling = obj('crm_board', OWN, {
      listViews: { foreign: { label: 'Foreign', data: { provider: 'object', object: 'nosuch_obj' }, columns: ['name'] } },
    });
    const flow = {
      name: 'crm_account_touched',
      label: 'Touched',
      status: 'active',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'On update', config: { objectName: 'crm_account', triggerType: 'record-after-update' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end', type: 'default', isDefault: false }],
    };
    const result = runRuntimeAuthoringRules({ type: 'flow', item: flow, context: { objects: [...OBJECTS, dangling] } });

    expect(rules([...result.errors, ...result.advisories])).not.toContain(LIST_VIEW_OBJECT_UNKNOWN);
    // Non-vacuous: written itself, the sibling IS refused.
    expect(rules(runRuntimeAuthoringRules({ type: 'object', item: dangling, context: { objects: OBJECTS } }).errors))
      .toEqual([LIST_VIEW_OBJECT_UNKNOWN]);
  });

  it('…nor to an object write that creates the object NEAREST to it — the suggestion moves, the fingerprint does not', () => {
    const dangling = obj('crm_board', undefined, {
      listViews: { typo: { label: 'Typo', data: { provider: 'object', object: 'crm_invoce' }, columns: ['name'] } },
    });
    const created = obj('crm_invoice');
    const result = runRuntimeAuthoringRules({ type: 'object', item: created, context: { objects: [...OBJECTS, dangling] } });

    expect(result.errors).toEqual([]);
    expect(rules(result.advisories)).not.toContain(LIST_VIEW_OBJECT_UNKNOWN);
    // Non-vacuous: the suggestion really does differ between the two
    // universes the differential compares.
    const before = validateListViewFieldRefs({ objects: [...OBJECTS, dangling] }, { wholeCollection: true });
    const after = validateListViewFieldRefs({ objects: [...OBJECTS, dangling, created] }, { wholeCollection: true });
    expect(rules(before)).toEqual([LIST_VIEW_OBJECT_UNKNOWN]);
    expect(rules(after)).toEqual([LIST_VIEW_OBJECT_UNKNOWN]);
    expect(after[0]!.hint).not.toEqual(before[0]!.hint);
    expect(after[0]!.message).toEqual(before[0]!.message);
  });
});

describe('the CLI reading is unchanged (#24668)', () => {
  const stack = { name: 'p', objects: [...OBJECTS], views: [listViewOn('nosuch_obj')] };

  it('the rule with no statement keeps skip 1', () => {
    expect(validateListViewFieldRefs(stack)).toEqual([]);
  });

  it('the suite with no runtime write type keeps skip 1', () => {
    expect(rules(validateReferenceIntegrity(stack))).not.toContain(LIST_VIEW_OBJECT_UNKNOWN);
    // …and the same stack judged as a runtime `view` snapshot is the verdict above.
    expect(rules(validateReferenceIntegrity(stack, { runtimeWriteType: 'view' }))).toContain(LIST_VIEW_OBJECT_UNKNOWN);
  });

  for (const command of ['validate', 'build', 'lint'] as const) {
    it(`\`${command}\` reports nothing for the binding`, () => {
      const { errors, advisories } = splitBySeverity(runAuthoringRules(command, { normalized: stack }));
      expect(rules([...errors, ...advisories])).not.toContain(LIST_VIEW_OBJECT_UNKNOWN);
    });
  }
});
