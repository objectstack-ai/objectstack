// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The field-axis split (ruling of record 6912661484), steps 2 and 3:
 *
 *   - `security-cross-set-field-reopen` warns when one set's `readable: false`
 *     on a field binds no holder of a second set whose `viewAllFields` on the
 *     object votes that field readable;
 *   - from v19 (#36055) View All and Modify All cast no field vote, so they
 *     re-open nothing and the rule is silent about them; `viewAllFields` votes
 *     read only, so an edit lock is never re-opened;
 *   - `security-wildcard-vama` reads `viewAllFields` on a package-authored
 *     `'*'` entry like the two record bits (L2 record 7063858938).
 */

import { describe, expect, it } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';

import {
  SECURITY_CROSS_SET_FIELD_REOPEN,
  SECURITY_WILDCARD_VAMA,
  validateSecurityPosture,
} from './validate-security-posture.js';

type AnyRec = Record<string, unknown>;

const DEAL = {
  name: 'deal',
  label: 'Deal',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    margin: { type: 'number', label: 'Margin' },
    salary: { type: 'number', label: 'Salary', requiredPermissions: ['view_compensation'] },
  },
};

/** The set that hides `deal.margin` from its holders. */
const consultant = (fields: AnyRec = { 'deal.margin': { readable: false, editable: false } }, deal: AnyRec = { allowRead: true }) => ({
  name: 'consultant',
  objects: { deal },
  fields,
});

const stackOf = (...permissions: AnyRec[]) => ({ objects: [DEAL], permissions });

const reopens = (stack: AnyRec) =>
  validateSecurityPosture(stack).filter((f) => f.rule === SECURITY_CROSS_SET_FIELD_REOPEN);

describe('security-cross-set-field-reopen · the two-set shape fires', () => {
  it('a second set\'s viewAllFields re-opens the hidden field: a warning on the hiding row, naming both sets and the field', () => {
    const found = reopens(stackOf(consultant(), { name: 'field_reader', objects: { deal: { allowRead: true, viewAllFields: true } } }));
    expect(found).toHaveLength(1);
    const [f] = found;
    expect(f!.severity).toBe('warning');
    expect(f!.where).toBe('permission set "consultant"');
    expect(f!.path).toBe('permissions[0].fields["deal.margin"]');
    expect(f!.message).toContain('"field_reader"');
    expect(f!.message).toContain("'deal.margin'");
    expect(f!.message).toContain('viewAllFields on objects.deal');
    expect(f!.userTextParams).toEqual({
      permissionSet: 'consultant', otherSet: 'field_reader', field: 'deal.margin', object: 'deal',
    });
    // The ruled steering for a high-sensitivity field.
    expect(f!.hint).toContain('requiredPermissions');
    expect(f!.hint).toContain('maskingRule');
  });

  it('[v19 #36055] View All or Modify All in the second set re-opens nothing, a mask or an edit lock', () => {
    for (const row of [{ readable: false, editable: false }, { readable: true, editable: false }]) {
      for (const deal of [{ allowRead: true, viewAllRecords: true }, { allowRead: true, allowEdit: true, modifyAllRecords: true }]) {
        expect(reopens(stackOf(consultant({ 'deal.margin': row }), { name: 'deal_lead', objects: { deal } })), JSON.stringify([row, deal]))
          .toEqual([]);
      }
    }
  });

  it('viewAllFields votes read only: an edit lock alone is never re-opened', () => {
    const readOnly = consultant({ 'deal.margin': { readable: true, editable: false } });
    expect(reopens(stackOf(readOnly, { name: 'field_reader', objects: { deal: { allowEdit: true, viewAllFields: true } } }))).toEqual([]);
  });

  it('a second set\'s viewAllFields re-opens the hidden field, on the object or through its \'*\' entry', () => {
    for (const objects of [{ deal: { allowRead: true, viewAllFields: true } }, { '*': { allowRead: true, viewAllFields: true } }]) {
      const found = reopens(stackOf(consultant(), { name: 'field_reader', objects }));
      expect(found, JSON.stringify(objects)).toHaveLength(1);
      expect(found[0]!.userTextParams).toMatchObject({ otherSet: 'field_reader' });
      expect(found[0]!.message).toContain(Object.keys(objects)[0] === '*' ? "objects['*']" : 'objects.deal');
    }
  });

  it('reads the same on parsed sets', () => {
    const found = reopens(stackOf(
      PermissionSetSchema.parse(consultant()),
      PermissionSetSchema.parse({ name: 'deal_auditor', objects: { deal: { allowRead: true, viewAllRecords: true, viewAllFields: true } } }),
    ));
    expect(found.map((f) => f.userTextParams?.otherSet)).toEqual(['deal_auditor']);
  });

  it('one finding per re-opening set', () => {
    const found = reopens(stackOf(
      consultant(),
      { name: 'deal_auditor', objects: { deal: { viewAllRecords: true, viewAllFields: true } } },
      { name: 'field_reader', objects: { deal: { viewAllFields: true } } },
    ));
    expect(found.map((f) => f.userTextParams?.otherSet)).toEqual(['deal_auditor', 'field_reader']);
  });
});

describe('security-cross-set-field-reopen · what it does not report', () => {
  it('one set alone: its own bit beside its own mask binds, so nothing fires', () => {
    for (const deal of [{ allowRead: true, viewAllRecords: true }, { allowRead: true, allowEdit: true, modifyAllRecords: true }, { allowRead: true, viewAllFields: true }]) {
      expect(reopens(stackOf(consultant(undefined, deal))), JSON.stringify(deal)).toEqual([]);
    }
  });

  it('a field gated by requiredPermissions on the field itself (ADR-0066 D3)', () => {
    const hidesSalary = consultant({ 'deal.salary': { readable: false, editable: false } });
    for (const deal of [{ viewAllRecords: true }, { modifyAllRecords: true }, { viewAllFields: true }]) {
      expect(reopens(stackOf(hidesSalary, { name: 'deal_auditor', objects: { deal } })), JSON.stringify(deal)).toEqual([]);
    }
  });

  it('a second set that masks the field itself beside viewAllFields casts no read vote on it', () => {
    for (const deal of [{ viewAllFields: true }, { viewAllRecords: true, viewAllFields: true }]) {
      const other = { name: 'deal_auditor', objects: { deal }, fields: { 'deal.margin': { readable: false } } };
      expect(reopens(stackOf(consultant(), other)), JSON.stringify(deal)).toEqual([]);
    }
  });

  it('a second set whose own entry for the object carries no bit: its \'*\' entry is not consulted', () => {
    const other = { name: 'deal_reader', objects: { deal: { allowRead: true }, '*': { viewAllFields: true } } };
    expect(reopens(stackOf(consultant(), other))).toEqual([]);
  });

  it('a second set that grants the object without a bit, and a field no set hides', () => {
    expect(reopens(stackOf(consultant(), { name: 'deal_reader', objects: { deal: { allowRead: true } } }))).toEqual([]);
    expect(reopens(stackOf(
      consultant({ 'deal.margin': { readable: true, editable: true } }),
      { name: 'deal_manager', objects: { deal: { modifyAllRecords: true, viewAllFields: true } } },
    ))).toEqual([]);
  });

  it('a key on an object this stack does not define, or naming a field the object does not declare', () => {
    const other = { name: 'superuser_ish', objects: { deal: { viewAllFields: true }, invoice: { viewAllFields: true } } };
    expect(reopens({ objects: [DEAL], permissions: [consultant({ 'invoice.total': { readable: false } }), other] })).toEqual([]);
    expect(reopens({ objects: [DEAL], permissions: [consultant({ 'deal.no_such_field': { readable: false } }), other] })).toEqual([]);
  });
});

describe('security-wildcard-vama · reads viewAllFields on a package-authored \'*\' entry', () => {
  const wildcard = (stack: AnyRec) => validateSecurityPosture(stack).filter((f) => f.rule === SECURITY_WILDCARD_VAMA);

  it('an error naming the bit, like the two record bits', () => {
    const [f, ...rest] = wildcard({ permissions: [{ name: 'field_reader', objects: { '*': { allowRead: true, viewAllFields: true } } }] });
    expect(rest).toEqual([]);
    expect(f!.severity).toBe('error');
    expect(f!.path).toBe('permissions[0].objects.*');
    expect(f!.message).toContain('viewAllFields');
    expect(f!.hint).toContain("drop viewAllFields from the '*' entry");
  });

  it('one finding for a wildcard that carries the record bits and viewAllFields, its hint naming all three', () => {
    const found = wildcard({ permissions: [{ name: 'admin', objects: { '*': { viewAllRecords: true, viewAllFields: true } } }] });
    expect(found).toHaveLength(1);
    expect(found[0]!.hint).toContain('viewAllRecords/modifyAllRecords/viewAllFields');
  });

  it('the record bits keep their wording; a per-object viewAllFields and a false bit are not reported', () => {
    const [recordOnly] = wildcard({ permissions: [{ name: 'admin', objects: { '*': { viewAllRecords: true } } }] });
    expect(recordOnly!.hint).toContain('viewAllRecords/modifyAllRecords');
    expect(recordOnly!.hint).not.toContain('viewAllFields');
    expect(recordOnly!.message).not.toContain('viewAllFields');
    expect(wildcard({ permissions: [{ name: 'r', objects: { deal: { allowRead: true, viewAllFields: true } } }] })).toEqual([]);
    expect(wildcard({ permissions: [{ name: 'r', objects: { '*': { allowRead: true, viewAllFields: false } } }] })).toEqual([]);
  });
});
