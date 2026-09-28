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

  it('is inert on junk: no objects, unnamed entries, non-array lists, non-string members', () => {
    expect(validateObjectFieldRefs({})).toEqual([]);
    expect(validateObjectFieldRefs({ objects: [] })).toEqual([]);
    // An entry with no `name` indexes into no graph and is skipped.
    expect(validateObjectFieldRefs({ objects: [{ highlightFields: ['x'] }] })).toEqual([]);
    expect(validateObjectFieldRefs(stackOf({ highlightFields: 'not-an-array' }))).toEqual([]);
    expect(validateObjectFieldRefs(stackOf({ highlightFields: [null, 3, ''] }))).toEqual([]);
    // A name-keyed `objects` map, the other shape the raw `lint` path carries.
    expect(validateObjectFieldRefs({
      objects: { proj_task: { fields: { name: {} }, highlightFields: ['nope'] } },
    })).toHaveLength(1);
    // ⛔ NOT asserted here: `objects: [null, …]`. `indexObjectGraph` throws a
    // TypeError on a null collection entry before any member of this suite is
    // reached — a pre-existing fragility of the shared seam, filed separately
    // rather than worked around in one member (a local guard here would leave
    // the same crash in every sibling and hide it).
  });
});

// ---------------------------------------------------------------------------
// [#5378] The injected-column derivation, at the position that moved.
//
// These counter-examples used to stand in `validate-semantic-roles.test.ts`,
// against the warning-tier clause this rule took over. They are re-pinned here
// at `error` rather than dropped: the derivation is exactly as load-bearing
// under a gate as it was under an advisory, and a false finding now REFUSES a
// publish instead of adding a line to a warning list.
// ---------------------------------------------------------------------------
describe('validateObjectFieldRefs — the #5378 derivation under a gate', () => {
  const tag = (over: Record<string, unknown>) => ({
    objects: [{ name: 'crm_tag', fields: { name: {} }, ...over }],
  });

  it.each(['none', 'org'])(
    "REFUSES highlightFields: [owner_id] on ownership: '%s' — the platform injects none",
    (ownership) => {
      const findings = validateObjectFieldRefs(tag({
        ownership, highlightFields: ['name', 'owner_id'],
      }));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: 'error', rule: OBJECT_FIELD_REF_UNKNOWN });
      expect(findings[0]!.message).toContain('owner_id');
    },
  );

  it('REFUSES an organization_id highlight when the object opts out of tenancy', () => {
    const findings = validateObjectFieldRefs(tag({
      tenancy: { enabled: false }, highlightFields: ['organization_id'],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('organization_id');
  });

  it('REFUSES a typo that merely LOOKS like a system column', () => {
    const findings = validateObjectFieldRefs({
      objects: [{ name: 'crm_contact', fields: { name: {} }, highlightFields: ['owner_ids', 'creatd_at'] }],
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/owner_ids/);
    expect(findings.map((f) => f.message).join(' ')).toMatch(/creatd_at/);
  });

  it.each([
    'created_at', 'created_by', 'updated_at', 'updated_by',
    'organization_id', 'owning_business_unit_id', 'id',
  ])('stays silent on highlightFields: [%s] — a real column at render time', (column) => {
    expect(validateObjectFieldRefs({
      objects: [{ name: 'crm_contact', fields: { name: {} }, highlightFields: ['name', column] }],
    })).toEqual([]);
  });

  it('a withheld anchor on an EXTERNAL object is still the existence verdict (#8116)', () => {
    const findings = validateObjectFieldRefs({
      objects: [{
        name: 'ext_customer',
        external: { remoteName: 'customers' },
        fields: { email: { type: 'email' } },
        ownership: 'none',
        highlightFields: ['owner_id'],
      }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe(OBJECT_FIELD_REF_UNKNOWN);
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

// ---------------------------------------------------------------------------
// [#20432] The field-level name lists and `indexes[].fields`.
//
// A two-object stack in the showcase's own shape: an invoice whose `account`
// lookup points at an account. The names each list may use are decided per
// key by its runtime READER (see the module note's table), so every block
// below pins BOTH directions of the address: a name of the object the list
// addresses passes, and a name that exists only on the OTHER object is still
// refused.
// ---------------------------------------------------------------------------
const account = (over: Record<string, unknown> = {}) => ({
  name: 'crm_account',
  fields: {
    name: { type: 'text' },
    industry: { type: 'select' },
    status: { type: 'select' },
    region: { type: 'text' },
  },
  ...over,
});

const invoice = (fields: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  name: 'crm_invoice',
  fields: {
    name: { type: 'text' },
    total: { type: 'currency' },
    region: { type: 'text' },
    // Owner-only field — the referenced account does not have it.
    issued_on: { type: 'date' },
    ...fields,
  },
  ...over,
});

const lookup = (over: Record<string, unknown> = {}) => ({
  type: 'lookup',
  reference: 'crm_account',
  ...over,
});

const twoObjects = (fields: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  objects: [invoice(fields, over), account()],
});

describe('validateObjectFieldRefs — relatedListColumns (addresses the OWNING object)', () => {
  it('REFUSES a misspelt column at the exact path, naming the owning object and its fields', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      account: lookup({ relatedListColumns: ['name', 'totl'] }),
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      path: 'objects[0].fields.account.relatedListColumns[1]',
      where: 'object "crm_invoice" › fields.account.relatedListColumns',
    });
    expect(findings[0]!.message).toContain('"totl" is not a field on object "crm_invoice"');
    expect(findings[0]!.message).toContain('Did you mean "total"?');
    // The prescription: the addressed object's field list.
    expect(findings[0]!.hint).toContain('Fields on "crm_invoice": account, issued_on, name, region, total.');
  });

  it('passes columns that are fields of the owning object (the child whose rows the list shows)', () => {
    expect(validateObjectFieldRefs(twoObjects({
      account: lookup({ relatedListColumns: ['name', 'total', 'issued_on'] }),
    }))).toEqual([]);
  });

  it('REFUSES a column that exists only on the REFERENCED object — the list shows the child\'s rows', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      account: lookup({ relatedListColumns: ['industry'] }),
    }));
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.account.relatedListColumns[0]']);
    expect(findings[0]!.message).toContain('object "crm_invoice"');
  });

  it('keeps the family\'s path resolution: a dotted column through a real lookup resolves', () => {
    expect(validateObjectFieldRefs(twoObjects({
      account: lookup({ relatedListColumns: ['account.industry'] }),
    }))).toEqual([]);
  });
});

describe('validateObjectFieldRefs — lookupColumns (addresses the REFERENCED object)', () => {
  it('REFUSES a misspelt name in the string arm, against the referenced object', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      account: lookup({ lookupColumns: ['name', 'industy'] }),
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      path: 'objects[0].fields.account.lookupColumns[1]',
    });
    expect(findings[0]!.message).toContain('"industy" is not a field on object "crm_account"');
    expect(findings[0]!.message).toContain('Did you mean "industry"?');
    expect(findings[0]!.hint).toContain('Fields on "crm_account": industry, name, region, status.');
  });

  it('REFUSES a misspelt `field` in the object arm, at `.field`', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      account: lookup({ lookupColumns: [{ field: 'stauts', label: 'Lifecycle' }] }),
    }));
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.account.lookupColumns[0].field']);
    expect(findings[0]!.rule).toBe(OBJECT_FIELD_REF_UNKNOWN);
  });

  it('passes both arms when every name is a field of the referenced object', () => {
    expect(validateObjectFieldRefs(twoObjects({
      account: lookup({ lookupColumns: ['name', { field: 'industry', label: 'Industry' }] }),
    }))).toEqual([]);
  });

  it('REFUSES a name that exists only on the OWNING object — the picker lists the referenced records', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      account: lookup({ lookupColumns: ['issued_on'] }),
    }));
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.account.lookupColumns[0]']);
    expect(findings[0]!.message).toContain('object "crm_account"');
  });

  it('judges a dotted name as ONE name — the picker reads its columns verbatim', () => {
    // `region` is a real field on the account; `account.region` would resolve
    // as a PATH from the invoice, but the picker never walks one.
    const findings = validateObjectFieldRefs(twoObjects({
      account: lookup({ lookupColumns: ['crm_account.region'] }),
    }));
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.account.lookupColumns[0]']);
  });

  it('judges a `user` field against `sys_user`, the target its type fixes', () => {
    const stack = {
      objects: [
        invoice({ approver: { type: 'user', lookupColumns: ['email', 'emial'] } }),
        { name: 'sys_user', fields: { name: { type: 'text' }, email: { type: 'email' } } },
      ],
    };
    const findings = validateObjectFieldRefs(stack);
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.approver.lookupColumns[1]']);
    expect(findings[0]!.message).toContain('object "sys_user"');
  });

  it('stays silent when the referenced object is not in this stack (skip 1)', () => {
    expect(validateObjectFieldRefs({
      objects: [invoice({ owner_account: lookup({ reference: 'elsewhere', lookupColumns: ['anything'] }) })],
    })).toEqual([]);
  });

  it('stays silent on a type with no picker: nothing reads the key there', () => {
    expect(validateObjectFieldRefs(twoObjects({
      notes: { type: 'text', lookupColumns: ['nope'] },
    }))).toEqual([]);
  });
});

describe('validateObjectFieldRefs — lookupFilters[].field (addresses the REFERENCED object)', () => {
  it('REFUSES a misspelt filter field against the referenced object, at `.field`', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      account: lookup({ lookupFilters: [{ field: 'statsu', operator: 'ne', value: 'churned' }] }),
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      path: 'objects[0].fields.account.lookupFilters[0].field',
    });
    expect(findings[0]!.message).toContain('"statsu" is not a field on object "crm_account"');
    expect(findings[0]!.hint).toContain('Fields on "crm_account":');
  });

  it('passes a filter over a field of the referenced object', () => {
    expect(validateObjectFieldRefs(twoObjects({
      account: lookup({ lookupFilters: [{ field: 'status', operator: 'ne', value: 'churned' }] }),
    }))).toEqual([]);
  });

  it('REFUSES a filter over a field only the OWNING object has', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      account: lookup({ lookupFilters: [{ field: 'total', operator: 'gt', value: 0 }] }),
    }));
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.account.lookupFilters[0].field']);
  });
});

describe('validateObjectFieldRefs — dependsOn (the gate on the OWNER, the filter on the REFERENCE)', () => {
  it('REFUSES a misspelt name in the string arm against the owning object — once, not twice', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      contact: lookup({ dependsOn: ['regoin'] }),
    }));
    // One typo, one finding: the same name is not reported again against the
    // referenced object, since one fix answers both.
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      path: 'objects[0].fields.contact.dependsOn[0]',
    });
    expect(findings[0]!.message).toContain('"regoin" is not a field on object "crm_invoice"');
    expect(findings[0]!.message).toContain('stays gated for good');
  });

  it('passes a bare name that is a field on BOTH sides (the shorthand)', () => {
    expect(validateObjectFieldRefs(twoObjects({
      contact: lookup({ dependsOn: ['region'] }),
    }))).toEqual([]);
  });

  it('REFUSES a bare name the owner has but the referenced object lacks — it is the filter key too', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      contact: lookup({ dependsOn: ['issued_on'] }),
    }));
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.contact.dependsOn[0]']);
    expect(findings[0]!.message).toContain('object "crm_account"');
    expect(findings[0]!.hint).toContain('param');
  });

  it('object arm: judges `field` on the owner and `param` on the referenced object', () => {
    expect(validateObjectFieldRefs(twoObjects({
      contact: lookup({ dependsOn: [{ field: 'issued_on', param: 'region' }] }),
    }))).toEqual([]);

    const findings = validateObjectFieldRefs(twoObjects({
      contact: lookup({ dependsOn: [{ field: 'isued_on', param: 'regon' }] }),
    }));
    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].fields.contact.dependsOn[0].field',
      'objects[0].fields.contact.dependsOn[0].param',
    ]);
    expect(findings[0]!.message).toContain('object "crm_invoice"');
    expect(findings[1]!.message).toContain('object "crm_account"');
  });

  it('object arm without `param`: `field` is the filter key as well', () => {
    const findings = validateObjectFieldRefs(twoObjects({
      contact: lookup({ dependsOn: [{ field: 'total' }] }),
    }));
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.contact.dependsOn[0].field']);
    expect(findings[0]!.message).toContain('object "crm_account"');
  });

  it('on a type with no picker, only the gate is judged — against the owning object', () => {
    // The cascading select: `province` gates on `country`, and its per-option
    // `visibleWhen` is the rule. No referenced object exists to judge against.
    const ok = { objects: [invoice({
      country: { type: 'select' },
      province: { type: 'select', dependsOn: ['country'] },
    })] };
    expect(validateObjectFieldRefs(ok)).toEqual([]);

    const findings = validateObjectFieldRefs({ objects: [invoice({
      country: { type: 'select' },
      province: { type: 'select', dependsOn: ['contry'] },
    })] });
    expect(findings.map((f) => f.path)).toEqual(['objects[0].fields.province.dependsOn[0]']);
    expect(findings[0]!.message).toContain('Did you mean "country"?');
  });

  it('a registry-injected column on the owner is a live gate (skip 3)', () => {
    expect(validateObjectFieldRefs({ objects: [invoice({
      note: { type: 'text', dependsOn: ['owner_id'] },
    }, { ownership: 'user' })] })).toEqual([]);
  });
});

describe('validateObjectFieldRefs — indexes[].fields (verbatim physical columns)', () => {
  it('REFUSES a misspelt index column at the exact path, with the owning object\'s field list', () => {
    const findings = validateObjectFieldRefs({ objects: [invoice({}, {
      indexes: [{ fields: ['name'] }, { fields: ['region', 'totl'], unique: true }],
    })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      path: 'objects[0].indexes[1].fields[1]',
      where: 'object "crm_invoice" › indexes[1].fields',
    });
    expect(findings[0]!.message).toContain('"totl" is not a field on object "crm_invoice"');
    expect(findings[0]!.message).toContain('Did you mean "total"?');
    expect(findings[0]!.message).toContain('`unique` index is then silently unenforced');
    expect(findings[0]!.hint).toContain('Fields on "crm_invoice":');
  });

  it('passes authored columns and the columns the platform injects', () => {
    expect(validateObjectFieldRefs({ objects: [invoice({}, {
      indexes: [
        { fields: ['region', 'total'], unique: true },
        { fields: ['organization_id', 'created_at'] },
        { fields: ['id'] },
      ],
    })] })).toEqual([]);
  });

  it('REFUSES a dotted column — an index names physical columns, never a path', () => {
    const findings = validateObjectFieldRefs({ objects: [invoice({ account: lookup() }, {
      indexes: [{ fields: ['account.name'] }],
    }), account()] });
    expect(findings.map((f) => f.path)).toEqual(['objects[0].indexes[0].fields[0]']);
  });

  it('judges EXISTENCE only: a virtual formula column resolves here, and materialization stays with the sync', () => {
    expect(validateObjectFieldRefs({ objects: [invoice({ margin: { type: 'formula' } }, {
      indexes: [{ fields: ['margin'] }],
    })] })).toEqual([]);
  });

  it('is inert on junk index entries', () => {
    expect(validateObjectFieldRefs({ objects: [invoice({}, {
      indexes: [null, 'x', { fields: 'name' }, { fields: [null, 3, ''] }, {}],
    })] })).toEqual([]);
  });
});

describe('validateObjectFieldRefs — the runtime publish door judges the new positions too', () => {
  it('refuses an object write whose index names a column it does not have', () => {
    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: obj({ indexes: [{ fields: ['name', 'helth_score'], unique: true }] }),
      context: { objects: [] },
    });
    const refusal = result.errors.find((f) => f.rule === OBJECT_FIELD_REF_UNKNOWN);
    expect(refusal, JSON.stringify(result.errors)).toBeDefined();
    expect(refusal!.path).toBe('objects.proj_task.indexes[0].fields[1]');
    expect(refusal!.severity).toBe('error');
  });

  it('resolves a lookup\'s picker columns against the referenced object the context carries', () => {
    const write = (lookupColumns: unknown[]) => runRuntimeAuthoringRules({
      type: 'object',
      // A publishable object in every other respect, so the only rule that
      // can speak is the one this block is about.
      item: invoice({ account: lookup({ lookupColumns }) }, {
        label: 'Invoice', sharingModel: 'private', nameField: 'name',
      }),
      context: { objects: [account()] },
    });
    expect(write(['name', 'industry']).errors, 'clean').toEqual([]);
    const refusal = write(['name', 'industy']).errors.find((f) => f.rule === OBJECT_FIELD_REF_UNKNOWN);
    expect(refusal).toBeDefined();
    expect(refusal!.path).toBe('objects.crm_invoice.fields.account.lookupColumns[1]');
  });
});
