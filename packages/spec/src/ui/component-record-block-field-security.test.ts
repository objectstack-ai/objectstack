// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #18159 — the record-block field-security pair, and the key that is
// deliberately NOT beside it.
//
// `record:details`, `record:highlights` and `record:related_list` are
// `strictObject`s, and objectui's `@object-ui/plugin-detail` reads three keys
// off each of them that none of the three declared: `enforceFieldSecurity`,
// `redactFields` and `requiredPermissions`. An author who wrote any of them was
// refused at parse while the renderer honoured the same document on the raw-node
// path — a contract that could not be satisfied by writing it down.
//
// This card declares TWO of the three and forks the third, so the pins below
// come in two kinds, and the difference matters:
//
//   ACCEPT pins  — `enforceFieldSecurity` / `redactFields` now parse GREEN on
//                  all three blocks. A full `safeParse` success is the assertion
//                  (not merely "no `unrecognized_keys`"): the value arm is part
//                  of what is being declared, and a key-only assertion would
//                  stay green over a declaration that refused every value.
//
//   ABSENCE pin  — `requiredPermissions` is still refused BY NAME on all three.
//                  That is a deliberate outcome, not an oversight. The renderer
//                  evaluates it as `perms.can(objectName, name)`, whose second
//                  parameter is this repo's closed `PermissionActionSchema` enum
//                  and NOT the ADR-0066 capability set every other
//                  `requiredPermissions` in this spec names. Measured on the two
//                  shipped providers: an unmapped name falls to the object's
//                  `allowRead` bit under the backend-backed one (so a capability
//                  nobody holds passes for every reader), and is denied for
//                  everyone under the role-based one whenever the object carries
//                  a permission config. Declaring it would mint the ADR-0049
//                  fail-open access gate this repo retired on
//                  `app.areas[].requiredPermissions` in 17.0.0.
//
//                  ⚠️ This pin is tree-scoped: it records what the contract
//                  accepts TODAY, not that the key may never be declared. The
//                  ruling that settles the fork updates this file in the same
//                  PR — it does not route around it.

import { describe, expect, it } from 'vitest';
import {
  ComponentPropsMap,
  RecordDetailsProps,
  RecordHighlightsProps,
  RecordQuickActionsProps,
  RecordRelatedListProps,
} from './component.zod';
import { PermissionActionSchema } from '../kernel/plugin-security-advanced.zod';

/** A document that is legal on its own, per block — the baseline every case adds to. */
const BASE: Record<string, Record<string, unknown>> = {
  'record:details': {},
  'record:highlights': { fields: ['name'] },
  'record:related_list': { objectName: 'task', relationshipField: 'parent_id' },
};

const BLOCKS = Object.keys(BASE) as Array<keyof typeof BASE>;

const parse = (type: string, extra: Record<string, unknown>) =>
  ComponentPropsMap[type as keyof typeof ComponentPropsMap].safeParse({ ...BASE[type], ...extra });

const unknownKeyIssue = (type: string, extra: Record<string, unknown>) => {
  const r = parse(type, extra);
  expect(r.success).toBe(false);
  return r.error!.issues.find((i) => i.code === 'unrecognized_keys');
};

describe('#18159 — the three blocks are the ones under test, and they are strict', () => {
  it('each baseline document parses on its own — the positive control every refusal below rests on', () => {
    for (const type of BLOCKS) {
      expect(parse(type, {}).success).toBe(true);
    }
  });

  it('each block still refuses a nonsense key BY NAME — the accept set widened, it did not open', () => {
    for (const type of BLOCKS) {
      const issue = unknownKeyIssue(type, { zzqx_no_such_key: 1 });
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('zzqx_no_such_key');
    }
  });

  it('the rows under test are the exported schemas, not look-alikes', () => {
    expect(ComponentPropsMap['record:details']).toBe(RecordDetailsProps);
    expect(ComponentPropsMap['record:highlights']).toBe(RecordHighlightsProps);
    expect(ComponentPropsMap['record:related_list']).toBe(RecordRelatedListProps);
  });
});

describe('#18159 — `enforceFieldSecurity` is declared on all three blocks', () => {
  it('parses GREEN with the key set — the whole document, not just the key name', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { enforceFieldSecurity: true });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).enforceFieldSecurity).toBe(true);
    }
  });

  it('accepts `false` — the explicit opt-out is a different fact from an absent key', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { enforceFieldSecurity: false });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).enforceFieldSecurity).toBe(false);
    }
  });

  it('carries NO schema default — an absent key stays absent, never "the author asked for off"', () => {
    for (const type of BLOCKS) {
      const r = parse(type, {});
      expect(r.success).toBe(true);
      expect(r.data as Record<string, unknown>).not.toHaveProperty('enforceFieldSecurity');
    }
  });

  it('refuses a non-boolean as a TYPE error, never as an unknown key', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { enforceFieldSecurity: 'yes' });
      expect(r.success).toBe(false);
      // The discrimination that matters: a key the schema does not know at all
      // reports `unrecognized_keys`. This one reports a value problem, which is
      // only possible because the key IS declared.
      expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
      expect(r.error!.issues.some((i) => i.code === 'invalid_type')).toBe(true);
    }
  });
});

describe('#18159 — `redactFields` is declared on all three blocks', () => {
  it('parses GREEN with the key set, and keeps the authored list', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { redactFields: ['salary', 'ssn'] });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).redactFields).toEqual(['salary', 'ssn']);
    }
  });

  it('accepts the empty list — "redact nothing", explicitly', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { redactFields: [] });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).redactFields).toEqual([]);
    }
  });

  it('refuses a bare string and a non-string member as TYPE errors, never as unknown keys', () => {
    for (const type of BLOCKS) {
      for (const bad of ['salary', [1]] as unknown[]) {
        const r = parse(type, { redactFields: bad });
        expect(r.success).toBe(false);
        expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
      }
    }
  });

  it('coexists with `enforceFieldSecurity` — the renderer folds them in ONE pass, so the contract must accept both at once', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { enforceFieldSecurity: true, redactFields: ['salary'] });
      expect(r.success).toBe(true);
    }
  });

  it('coexists with `record:details`\' neighbouring `hideFields` — two channels, one document', () => {
    const r = parse('record:details', { hideFields: ['name'], redactFields: ['salary'] });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).hideFields).toEqual(['name']);
    expect((r.data as Record<string, unknown>).redactFields).toEqual(['salary']);
  });
});

describe('#18159 — `requiredPermissions` is REFUSED on the three blocks (the forked key)', () => {
  it('is refused by name on each of the three, with the base document legal on its own', () => {
    for (const type of BLOCKS) {
      const issue = unknownKeyIssue(type, { requiredPermissions: ['crm.manage'] });
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('requiredPermissions');
    }
  });

  it('is refused for the CRUD spelling too — the refusal is the key, not the value', () => {
    for (const type of BLOCKS) {
      expect(unknownKeyIssue(type, { requiredPermissions: ['read'] })).toBeDefined();
    }
  });

  it('the sibling `record:quick_actions` DOES declare it — the distinction a whole-file screen gets backwards', () => {
    const r = RecordQuickActionsProps.safeParse({ requiredPermissions: ['crm.manage'] });
    expect(r.success).toBe(true);
    expect(ComponentPropsMap['record:quick_actions']).toBe(RecordQuickActionsProps);
  });

  it('names a vocabulary the renderer\'s evaluator cannot express: `perms.can()` takes the closed PermissionAction enum', () => {
    // Why the key forks rather than being declared. `requiredPermissions` means
    // ADR-0066 CAPABILITIES everywhere else in this spec (`action`, `app`,
    // `field`, `bulkAction`); the renderer routes it into the object-ACTION
    // evaluator, whose vocabulary is this enum and nothing else.
    expect(PermissionActionSchema.safeParse('read').success).toBe(true);
    expect(PermissionActionSchema.safeParse('update').success).toBe(true);
    expect(PermissionActionSchema.safeParse('crm.manage').success).toBe(false);
    expect(PermissionActionSchema.safeParse('showcase.restricted_ops').success).toBe(false);
  });
});

describe('#18159 — the pair was declared on THESE blocks only', () => {
  it('the sibling `record:quick_actions` still refuses both keys — no spray', () => {
    for (const key of ['enforceFieldSecurity', 'redactFields'] as const) {
      const r = RecordQuickActionsProps.safeParse({
        [key]: key === 'enforceFieldSecurity' ? true : ['salary'],
      });
      expect(r.success).toBe(false);
      expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('exactly three rows in `ComponentPropsMap` declare each key', () => {
    const declaring = (key: string) =>
      Object.entries(ComponentPropsMap)
        .filter(([, schema]) => Object.keys((schema as { shape?: object }).shape ?? {}).includes(key))
        .map(([type]) => type)
        .sort();
    expect(declaring('enforceFieldSecurity')).toEqual([...BLOCKS].sort());
    expect(declaring('redactFields')).toEqual([...BLOCKS].sort());
    // The control that the census above can find a key at all.
    expect(declaring('requiredPermissions')).toEqual(['record:quick_actions']);
  });
});
