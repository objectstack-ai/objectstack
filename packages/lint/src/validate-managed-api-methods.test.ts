// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7521 — the authoring-time gate for `enable.apiMethods` ⊆ affordances.
//
// The predicate's own verdict table is tested in `@objectstack/spec`
// (`managed-api-affordance.test.ts`); what is tested HERE is the walk — which
// stack shapes are reached, and whether a conflict becomes a finding an author
// can act on.

import { describe, expect, it } from 'vitest';

import { MANAGED_WRITE_VERB_AFFORDANCE } from '@objectstack/spec/data';

import { explainRule } from './rule-explanations.js';
import {
  MANAGED_API_METHOD_UNAFFORDABLE,
  validateManagedApiMethods as validateManagedApiMethodsUnrecorded,
} from './validate-managed-api-methods';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain object/managed-api-method-unaffordable`. Every direct
// call below records what it fired, and the last cases in this file hold each
// recorded verdict to one line of at most 200 characters — every firing
// variant this suite exercises, not a chosen few. Run the whole file: those
// cases read what the cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateManagedApiMethods: typeof validateManagedApiMethodsUnrecorded = (...args) => {
  const findings = validateManagedApiMethodsUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

/** The #7521 shape: `platform` bucket, `userActions` closing every write. */
const sysEnvironment = {
  name: 'sys_environment',
  managedBy: 'platform',
  userActions: { create: false, edit: false, delete: false },
  enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update'] },
};

describe('validateManagedApiMethods — the finding', () => {
  it('flags the declaration #7521 was filed for', () => {
    const findings = validateManagedApiMethods({ objects: [sysEnvironment] });
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(MANAGED_API_METHOD_UNAFFORDABLE);
    expect(f.where).toBe('object "sys_environment"');
    expect(f.path).toBe('objects[0].enable.apiMethods');
    expect(f.message).toContain('create, update');
    expect(f.message).toContain("managedBy: 'platform'");
  });

  it('offers both ways out, and names the affordances that would be needed', () => {
    const [f] = validateManagedApiMethods({ objects: [sysEnvironment] });
    expect(f.hint).toContain('userActions: { create: true, edit: true }');
    expect(f.hint).toContain('remove');
    // ADR-0092 D4 — an author must not open the affordance to silence a lint.
    expect(f.hint).toContain('ADR-0092 D4');
  });

  it('emits ONE finding per object, not one per offending verb', () => {
    // Three refused verbs, one authoring mistake, one edit to fix it.
    const findings = validateManagedApiMethods({
      objects: [
        {
          name: 'sys_thing',
          managedBy: 'better-auth',
          enable: { apiMethods: ['get', 'create', 'update', 'delete'] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('create, update, delete');
  });
});

describe('validateManagedApiMethods — the walk', () => {
  it('reads objects declared as a name-keyed map as well as an array', () => {
    const findings = validateManagedApiMethods({ objects: { sys_environment: sysEnvironment } });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('object "sys_environment"');
  });

  it('reports the index of the offending object, not of the finding', () => {
    const clean = { name: 'crm_lead', enable: { apiMethods: ['get', 'create'] } };
    const findings = validateManagedApiMethods({ objects: [clean, clean, sysEnvironment] });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[2].enable.apiMethods');
  });

  it('stays silent on a coherent stack', () => {
    const findings = validateManagedApiMethods({
      objects: [
        // Unmanaged — no bucket default to contradict.
        { name: 'crm_lead', enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete'] } },
        // Managed, and the affordance is declared (the `sys_api_key` shape).
        {
          name: 'sys_api_key',
          managedBy: 'better-auth',
          userActions: { edit: true },
          enable: { apiMethods: ['get', 'list', 'update'] },
        },
        // Managed and read-only — reads are never affordance-gated.
        { name: 'sys_email', managedBy: 'append-only', enable: { apiMethods: ['get', 'list'] } },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('survives a stack that is missing, junk, or has no objects at all', () => {
    expect(validateManagedApiMethods(undefined)).toEqual([]);
    expect(validateManagedApiMethods('nope')).toEqual([]);
    expect(validateManagedApiMethods({})).toEqual([]);
    expect(validateManagedApiMethods({ objects: [null, 42] })).toEqual([]);
  });
});

describe('[#22161] one-line verdicts — object/managed-api-method-unaffordable', () => {
  it('reads as one sentence, the object left to `where`', () => {
    const [f] = validateManagedApiMethods({ objects: [sysEnvironment] });
    expect(f.message).toBe(
      "`enable.apiMethods` advertises [create, update], which `managedBy: 'platform'` affordances refuse "
        + '(needs userActions create/edit), so the registry strips them',
    );
    expect(f.message).not.toContain('sys_environment');
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(MANAGED_API_METHOD_UNAFFORDABLE);
    expect(entry, 'no `os explain object/managed-api-method-unaffordable` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      'ADR-0092, ADR-0103',
      '`checkManagedApiMethodAffordances`',
      'the only trace is a boot-log line',
      'warn-and-strip on purpose',
      'One finding per object, not per verb',
      'ADR-0092 D4',
      'Reads are never affordance-gated',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('the verb table the explanation names is the shared predicate\'s, verb by verb', () => {
    // The explanation module imports nothing, so its verb → affordance table is
    // held to `MANAGED_WRITE_VERB_AFFORDANCE` here, and each row to the rule by
    // running the rule on an all-locked object advertising that one verb.
    const text = explainRule(MANAGED_API_METHOD_UNAFFORDABLE)!.paragraphs.join('\n');
    expect(MANAGED_WRITE_VERB_AFFORDANCE).toEqual({
      create: 'create', update: 'edit', upsert: 'edit', delete: 'delete', purge: 'delete',
    });
    expect(text).toContain(
      '`create` needs `create`, `update` and `upsert` need `edit`, `delete` and `purge` need `delete`',
    );
    for (const [verb, needs] of Object.entries(MANAGED_WRITE_VERB_AFFORDANCE)) {
      const findings = validateManagedApiMethodsUnrecorded({
        objects: [{ name: 'sys_locked', managedBy: 'better-auth', enable: { apiMethods: ['get', verb] } }],
      });
      expect(findings, verb).toHaveLength(1);
      expect(findings[0].message, verb).toContain(`[${verb}]`);
      expect(findings[0].message, verb).toContain(`(needs userActions ${needs})`);
    }
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === MANAGED_API_METHOD_UNAFFORDABLE);
    // The coverage control first: one verb and several verbs both fired.
    expect(converted.some((f) => f.message.includes('[create, update]'))).toBe(true);
    expect(converted.some((f) => f.message.includes('[create, update, delete]'))).toBe(true);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});
