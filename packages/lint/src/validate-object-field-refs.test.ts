// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { AUTHORING_RULES } from './authoring-rules.js';
import {
  OBJECT_FIELD_REF_UNKNOWN,
  validateObjectFieldRefs,
} from './validate-object-field-refs.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import { SEMANTIC_ROLE_FIELD_UNKNOWN, validateSemanticRoles } from './validate-semantic-roles.js';

const obj = (over: Record<string, unknown> = {}) => ({
  name: 'proj_task',
  label: 'Task',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    health_score: { type: 'number', label: 'Health Score' },
  },
  nameField: 'name',
  ...over,
});

const stackOf = (over: Record<string, unknown> = {}) => ({ objects: [obj(over)] });

describe('validateObjectFieldRefs — highlightFields', () => {
  it('REFUSES a dangling entry at `error`, naming the rule id and the offending path', () => {
    const findings = validateObjectFieldRefs(stackOf({ highlightFields: ['name', 'field_10'] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      path: 'objects[0].highlightFields[1]',
    });
    // The author must read back the string they typed and the object it was
    // resolved against — a finding that names neither is unactionable.
    expect(findings[0]!.message).toContain('field_10');
    expect(findings[0]!.message).toContain('proj_task');
    // …and the fields that DO exist, so the fix is one read away.
    expect(findings[0]!.hint).toContain('health_score');
  });

  it('passes a list whose every entry names a real field', () => {
    expect(validateObjectFieldRefs(stackOf({ highlightFields: ['name', 'health_score'] })))
      .toEqual([]);
  });

  it('reports EVERY dangling entry, not only the first', () => {
    const findings = validateObjectFieldRefs(
      stackOf({ highlightFields: ['nope_one', 'name', 'nope_two'] }),
    );
    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].highlightFields[0]',
      'objects[0].highlightFields[2]',
    ]);
  });

  it('judges the retired `compactLayout` spelling at the same position (raw `lint` input)', () => {
    // Not an accepted spelling — `ObjectSchema` refuses it and the ADR-0085
    // conversion normalizes it away before the parsed tier. Read here only so
    // the raw `lint` path keeps the coverage this clause took over from
    // `validateSemanticRoles`. See the rule's module note.
    const findings = validateObjectFieldRefs(stackOf({ compactLayout: ['name', 'field_10'] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      path: 'objects[0].compactLayout[1]',
    });
  });
});

describe('validateObjectFieldRefs — the Studio click path (#15254)', () => {
  // The reproduction from the card, in the order an author actually clicks:
  //   1. click-create a Number field  → it is minted as `field_10`
  //   2. add it to `highlightFields`  → the list references `field_10`
  //   3. set its label to "Health Score" → the API name auto-derives to
  //      `health_score`, and `highlightFields` still says `field_10`
  // Naming a field after placing it is the natural order, so this is the
  // shape ANY author produces — not a contrived mutation.
  const afterDerivedRename = stackOf({
    // step 3 has happened: the field is `health_score` …
    fields: { name: { type: 'text' }, health_score: { type: 'number', label: 'Health Score' } },
    // … and step 2's reference was never rewritten.
    highlightFields: ['field_10'],
  });

  it('REFUSES the derived-rename scenario `field_10` → `health_score`', () => {
    const findings = validateObjectFieldRefs(afterDerivedRename);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.rule).toBe(OBJECT_FIELD_REF_UNKNOWN);
    expect(findings[0]!.path).toBe('objects[0].highlightFields[0]');
  });

  it('the SAME body publishes clean once the reference is rewritten', () => {
    expect(validateObjectFieldRefs(stackOf({
      fields: { name: { type: 'text' }, health_score: { type: 'number' } },
      highlightFields: ['health_score'],
    }))).toEqual([]);
  });

  it('the RUNTIME publish door refuses it — the door a Studio tenant actually has', () => {
    // The whole point of the card: this is the fourth wall (#4463), reached by
    // Studio, REST `/meta` and MCP authors alike, and it is the ONLY one a
    // tenant has. Before #15254 it dispatched no reference-integrity rule at
    // all on an object write.
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name))
      .toContain('validateReferenceIntegrity');

    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: afterDerivedRename.objects[0],
      context: { objects: [] },
    });

    const refusal = result.errors.find((f) => f.rule === OBJECT_FIELD_REF_UNKNOWN);
    expect(refusal, JSON.stringify(result.errors)).toBeDefined();
    // Name-keyed on the wire (#10064), which is the path the card asks to see
    // on screen: `objects.<name>.highlightFields[i]`, never a snapshot index.
    expect(refusal!.path).toBe('objects.proj_task.highlightFields[0]');
    expect(refusal!.severity).toBe('error');
    // `rulesRun` is non-empty, so "clean" and "nothing ran" stay distinguishable.
    expect(result.rulesRun).toContain('validateReferenceIntegrity');
  });

  it('a clean object still publishes through that door', () => {
    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: obj({ highlightFields: ['name', 'health_score'] }),
      context: { objects: [] },
    });
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  });

  it('does not blame this write for a STORED sibling already dangling (#4463 D4)', () => {
    const stored = obj({ name: 'legacy_thing', highlightFields: ['long_gone'] });
    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: obj({ highlightFields: ['name'] }),
      context: { objects: [stored] },
    });
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  });
});

describe('validateObjectFieldRefs — publicSharing.redactFields', () => {
  it('REFUSES a dangling redaction — the one that fails OPEN', () => {
    const findings = validateObjectFieldRefs(stackOf({
      publicSharing: { enabled: true, redactFields: ['helth_score'] },
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      path: 'objects[0].publicSharing.redactFields[0]',
    });
    // The consequence sentence is the point of the position: it is not that
    // the field renders short, it is that it is SERVED.
    expect(findings[0]!.message).toMatch(/fails OPEN/i);
    // A near-miss carries the suggestion.
    expect(findings[0]!.message).toContain('health_score');
  });

  it('passes a redaction list whose entries all resolve', () => {
    expect(validateObjectFieldRefs(stackOf({
      publicSharing: { enabled: true, redactFields: ['health_score'] },
    }))).toEqual([]);
  });
});

describe('validateObjectFieldRefs — the three shared skips', () => {
  it('skip 3: a registry-injected system column is a LIVE pointer, not a miss (#5378)', () => {
    expect(validateObjectFieldRefs({
      objects: [obj({ ownership: 'user', highlightFields: ['name', 'owner_id'] })],
    })).toEqual([]);
  });

  it('skip 3, the other direction: `ownership: none` injects no owner_id, so it IS a miss', () => {
    const findings = validateObjectFieldRefs({
      objects: [obj({ ownership: 'none', highlightFields: ['owner_id'] })],
    });
    expect(findings.map((f) => f.rule)).toEqual([OBJECT_FIELD_REF_UNKNOWN]);
  });

  it('skip 2: an object with no readable field map is never judged (ADR-0015 external)', () => {
    expect(validateObjectFieldRefs({
      objects: [{
        name: 'remote_thing',
        external: { remoteName: 'things', writable: false },
        highlightFields: ['whatever_the_remote_calls_it'],
      }],
    })).toEqual([]);
  });

  it('is inert on junk: no objects, junk entries, non-array lists', () => {
    expect(validateObjectFieldRefs({})).toEqual([]);
    expect(validateObjectFieldRefs({ objects: [null, 7, 'x'] as never })).toEqual([]);
    expect(validateObjectFieldRefs(stackOf({ highlightFields: 'not-an-array' }))).toEqual([]);
    expect(validateObjectFieldRefs(stackOf({ highlightFields: [null, 3, ''] }))).toEqual([]);
  });
});

describe('the clause that moved out of validateSemanticRoles', () => {
  it('semantic roles no longer double-reports highlightFields EXISTENCE', () => {
    const stack = stackOf({ highlightFields: ['field_10'] });
    const semantic = validateSemanticRoles(stack).filter(
      (f) => f.rule === SEMANTIC_ROLE_FIELD_UNKNOWN && f.path.includes('highlightFields'),
    );
    expect(semantic, JSON.stringify(semantic)).toEqual([]);
    // One finding on the path, at the gating tier, not two at two tiers.
    expect(validateObjectFieldRefs(stack)).toHaveLength(1);
  });

  it('semantic roles KEEPS stageField — a scalar role pointer, still advisory', () => {
    const findings = validateSemanticRoles(stackOf({ stageField: 'pipeline' }));
    expect(findings.map((f) => f.rule)).toContain(SEMANTIC_ROLE_FIELD_UNKNOWN);
    expect(findings.find((f) => f.rule === SEMANTIC_ROLE_FIELD_UNKNOWN)!.severity).toBe('warning');
    // …and this rule does not take it: lists only, see the module note.
    expect(validateObjectFieldRefs(stackOf({ stageField: 'pipeline' }))).toEqual([]);
  });

  it('semantic roles KEEPS the PROVENANCE question at the highlightFields position', () => {
    // An ADR-0015 external object: the injected anchor RESOLVES (so this rule
    // is silent, skip 3) but nothing provisions storage behind it (#8116).
    const external = {
      name: 'remote_thing',
      external: { remoteName: 'things', writable: false },
      fields: { email: { type: 'text' } },
      ownership: 'user',
      highlightFields: ['email', 'owner_id'],
    };
    const findings = validateSemanticRoles({ objects: [external] });
    expect(findings.map((f) => f.rule)).toContain('semantic-role-field-unprovisioned');
  });
});

describe('registry wiring', () => {
  it('reaches all three commands through the reference-integrity suite entry', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateReferenceIntegrity')!;
    expect(entry.tier).toBe('gating');
    expect(entry.commands).toEqual(expect.arrayContaining(['validate', 'build', 'lint']));
    expect(entry.surfaces).toContain('runtime-publish');
    expect(entry.runtimeTypes).toContain('object');
  });
});
