// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30303] `security-fls-unknown-field` resolves an `object.field` key against
 * the object as the registry SERVES it: its declaration with every
 * `objectExtensions` entry that extends it folded in, a sibling package body's
 * included (`objectsAsServed`, the fold the controlled-by-parent merge of
 * #23210 reads too).
 *
 * The card's shape: an app package owns `crm_contract` and the permission
 * sets; a module package of the same artifact adds `o2c_probe_note` to
 * `crm_contract` through `objectExtensions`. The runtime serves the field, so
 * an app-package set may name it. A key no body declares or extends is still
 * refused, with the message it always had, and so is a field an extension
 * names in a way the registry does not merge.
 *
 * Each stack is parsed by `ObjectStackDefinitionSchema` first and the rule
 * runs on the parsed tree, the tier it is registered on (`input: 'parsed'`).
 */
import { describe, it, expect } from 'vitest';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';
import { validateSecurityPosture, SECURITY_FLS_UNKNOWN_FIELD } from './validate-security-posture.js';

type AnyRec = Record<string, unknown>;

const CONTRACT = {
  name: 'crm_contract',
  label: 'Contract',
  sharingModel: 'private',
  fields: { contract_no: { type: 'text', label: 'Contract No' } },
};

const setNaming = (...keys: string[]) => ({
  name: 'finance_editor',
  label: 'Finance Editor',
  objects: { crm_contract: { allowRead: true, allowEdit: true } },
  fields: Object.fromEntries(keys.map((key) => [key, { readable: true, editable: true }])),
});

const NOTE = { o2c_probe_note: { type: 'textarea', label: 'O2C Probe Note' } };

const body = (id: string, type: string, extra: AnyRec) => ({
  manifest: { id, name: id, version: '1.0.0', type, ...extra },
});

/** The app package: the object and the permission set. */
const appBody = (...keys: string[]) =>
  body('app.objectstack.hotcrm', 'app', { objects: [CONTRACT], permissions: [setNaming(...keys)] });

/** The module package: its extensions of the app's object. */
const moduleBody = (objectExtensions: AnyRec[]) =>
  body('app.objectstack.hotcrm.o2c', 'module', { objectExtensions });

const parsed = (stack: AnyRec): AnyRec => {
  const result = ObjectStackDefinitionSchema.safeParse(stack);
  expect(result.success, result.success ? '' : JSON.stringify(result.error.issues, null, 2)).toBe(true);
  return result.data as AnyRec;
};

/**
 * The two stacks the CLI hands the rule for one artifact
 * (`packages/cli/src/utils/artifact-packages.ts`, `stack-collections.ts`):
 * the per-package run over the app body (`packageBodyAsStack`: the body, with
 * the artifact's `packages[]` as resolution context), and the union run (the
 * bodies' collections folded onto the top level, `authoringRuleUnionStack`).
 */
const runsOf = (artifact: AnyRec): Array<[string, AnyRec]> => {
  const packages = artifact.packages as Array<{ manifest: AnyRec }>;
  const app = packages.find((p) => p.manifest.type === 'app')!.manifest;
  const union: AnyRec = { ...artifact };
  for (const key of ['objects', 'permissions', 'objectExtensions']) {
    const items = packages.flatMap((p) => (Array.isArray(p.manifest[key]) ? (p.manifest[key] as unknown[]) : []));
    if (items.length > 0) union[key] = items;
  }
  return [
    ['per-package (app body)', { ...app, manifest: app, packages }],
    ['union', union],
  ];
};

const flsFindings = (stack: AnyRec) =>
  validateSecurityPosture(stack).filter((f) => f.rule === SECURITY_FLS_UNKNOWN_FIELD);

describe('[#30303] security-fls-unknown-field reads the object as the registry serves it', () => {
  it('the card\'s artifact: an app-package set naming a field a sibling module extends is accepted, on both runs', () => {
    const artifact = parsed({
      packages: [appBody('crm_contract.o2c_probe_note'), moduleBody([{ extend: 'crm_contract', fields: NOTE }])],
    });
    for (const [run, stack] of runsOf(artifact)) {
      expect(flsFindings(stack), run).toEqual([]);
    }
  });

  it('the same artifact without the module\'s extension still refuses the key (the control the pin above stands beside)', () => {
    const artifact = parsed({ packages: [appBody('crm_contract.o2c_probe_note'), moduleBody([])] });
    for (const [run, stack] of runsOf(artifact)) {
      expect(flsFindings(stack).map((f) => f.path), run).toEqual(['permissions[0].fields["crm_contract.o2c_probe_note"]']);
    }
  });

  it('a key on a field no body declares or extends is still refused, in the words it always had', () => {
    const artifact = parsed({
      packages: [
        appBody('crm_contract.o2c_probe_note', 'crm_contract.o2c_nowhere'),
        moduleBody([{ extend: 'crm_contract', fields: NOTE }]),
      ],
    });
    // The control: one object, no extension anywhere, the same unknown key.
    const control = flsFindings(parsed({ objects: [CONTRACT], permissions: [setNaming('crm_contract.o2c_nowhere')] }));
    expect(control).toHaveLength(1);
    for (const [run, stack] of runsOf(artifact)) {
      const findings = flsFindings(stack);
      expect(findings.map((f) => [f.severity, f.path]), run).toEqual([
        ['error', 'permissions[0].fields["crm_contract.o2c_nowhere"]'],
      ]);
      expect(findings[0].where, run).toBe(control[0].where);
      expect(findings[0].message, run).toBe(control[0].message);
    }
  });

  it('a single-package stack with an in-body extension: no finding; without the extension the key is refused', () => {
    const stack = (objectExtensions: AnyRec[]) =>
      parsed({ objects: [CONTRACT], objectExtensions, permissions: [setNaming('crm_contract.o2c_probe_note')] });
    expect(flsFindings(stack([{ extend: 'crm_contract', fields: NOTE }]))).toEqual([]);
    expect(flsFindings(stack([])).map((f) => f.path)).toEqual(['permissions[0].fields["crm_contract.o2c_probe_note"]']);
  });

  it('the hint\'s nearest name reads the served fields too', () => {
    const artifact = parsed({
      packages: [appBody('crm_contract.o2c_probe_notes'), moduleBody([{ extend: 'crm_contract', fields: NOTE }])],
    });
    for (const [run, stack] of runsOf(artifact)) {
      expect(flsFindings(stack).map((f) => f.hint), run).toEqual([
        'Point the key at a field "crm_contract" declares (\'crm_contract.o2c_probe_note\' is the nearest), or delete the entry if the field is gone',
      ]);
    }
  });
});

// ── Extensions the registry does not merge stay refused ──────────────────
//
// `ObjectQL.registerApp` registers each entry as an `extend` contribution
// under the name its `extend` spells (`SchemaRegistry.registerObject`), and a
// package's later contribution to one object replaces its earlier one; the
// fold merges each contribution's `fields`, and its `fieldPatches` only patch
// the owner's own fields. Each case below is a field the served object does
// not have.
describe('[#30303] a field the registry would not serve is still refused', () => {
  const refusedOn = (objectExtensions: AnyRec[]) => {
    const artifact = parsed({ packages: [appBody('crm_contract.o2c_probe_note'), moduleBody(objectExtensions)] });
    return runsOf(artifact).map(([run, stack]) => [run, flsFindings(stack).map((f) => f.path)]);
  };
  const REFUSED = ['permissions[0].fields["crm_contract.o2c_probe_note"]'];

  it('a field one package\'s earlier entry adds, when a later entry of the same package extends the same object', () => {
    const replaced = [
      { extend: 'crm_contract', fields: NOTE },
      { extend: 'crm_contract', fields: { o2c_other: { type: 'text', label: 'Other' } } },
    ];
    expect(refusedOn(replaced)).toEqual([
      ['per-package (app body)', REFUSED],
      ['union', REFUSED],
    ]);
    // Its twin, the same two entries in the other order: the later one adds the field.
    expect(refusedOn([...replaced].reverse())).toEqual([
      ['per-package (app body)', []],
      ['union', []],
    ]);
  });

  it('a field an extension only patches (fieldPatches add no field)', () => {
    expect(refusedOn([{ extend: 'crm_contract', fieldPatches: { o2c_probe_note: { label: 'Probe' } } }])).toEqual([
      ['per-package (app body)', REFUSED],
      ['union', REFUSED],
    ]);
  });

  it('a field an extension adds to an object of another spelling', () => {
    expect(refusedOn([{ extend: 'crm__crm_contract', fields: NOTE }])).toEqual([
      ['per-package (app body)', REFUSED],
      ['union', REFUSED],
    ]);
  });
});
