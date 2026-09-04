// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { BOUNDED_STRING_FIELD_TYPES, VALUE_DOMAIN_FIELD_TYPES } from '@objectstack/spec/data';
import { validateRecord, ValidationError } from './record-validator.js';

/**
 * #14168 (maintainer ruling 2026-09-02, option A) — `Field.valueDomain` binds
 * at the write seam. The spec half declared the slot, the closed vocabulary
 * (`iana_time_zone` / `iso_4217_currency` / `iso_3166_alpha2`), the ONE shared
 * membership predicate `isValueDomainMember`, the ADR-0114 catalog member
 * `value_domain` and its four-locale templates; this is the enforcement half —
 * without it a declared domain parsed and constrained nothing, the
 * declared-but-inert shape ADR-0078 keeps out.
 *
 * The predicate is the settings door's own, deliberately: a time zone accepted
 * in Settings is the time zone accepted in a field. These pins therefore assert
 * the ENVELOPE (`code` + `constraint.valueDomain`) rather than re-testing
 * membership — the vocabulary's own membership pins live beside the predicate
 * in `packages/spec`.
 */

const fieldsOf = (
  schema: unknown,
  data: Record<string, unknown>,
  mode: 'insert' | 'update' = 'insert',
) => {
  try {
    validateRecord(schema as never, data, mode);
  } catch (e) {
    return (e as ValidationError).fields;
  }
  return null;
};

/**
 * The reachability invariant this enforcement rides on. The check lives inside
 * the bounded-string branch (beside `maxLength`'s seam, where the card puts
 * it), so a type that may AUTHOR a domain must also reach that branch. Today
 * `VALUE_DOMAIN_FIELD_TYPES` is `{text}` and `BOUNDED_STRING_FIELD_TYPES` is
 * the twelve-member `maxLength` family — a strict subset. If the spec ever
 * widens the domain set to a type outside the bounded-string family, this pin
 * goes red instead of the enforcement silently ceasing to fire for it: the
 * failure mode a subset relation would otherwise hide.
 */
describe('Field.valueDomain — the enforcement is reachable for every type that may author it', () => {
  it('VALUE_DOMAIN_FIELD_TYPES is a subset of BOUNDED_STRING_FIELD_TYPES', () => {
    const outside = [...VALUE_DOMAIN_FIELD_TYPES].filter((t) => !BOUNDED_STRING_FIELD_TYPES.has(t));
    expect(outside).toEqual([]);
  });
});

/**
 * The card's exact matrix: one pin per vocabulary member, member admitted and
 * non-member refused. Each non-member is chosen to be a case a `pattern` could
 * not catch — `ZZ` is shape-valid and unassigned, `Mars/Olympus` is a
 * shape-valid zone that does not exist, and `chf` is the right code in the
 * wrong case (ISO 4217 is exact uppercase).
 */
describe('validateRecord — Field.valueDomain refuses a non-member on the write path (#14168)', () => {
  const CASES = [
    { domain: 'iso_3166_alpha2', member: 'CH', nonMember: 'ZZ' },
    { domain: 'iana_time_zone', member: 'UTC', nonMember: 'Mars/Olympus' },
    { domain: 'iso_4217_currency', member: 'CHF', nonMember: 'chf' },
  ] as const;

  for (const { domain, member, nonMember } of CASES) {
    const schema = { fields: { code: { type: 'text', valueDomain: domain } } };

    it(`${domain}: admits the member '${member}'`, () => {
      expect(fieldsOf(schema, { code: member })).toBeNull();
    });

    it(`${domain}: refuses the non-member '${nonMember}' with value_domain + constraint.valueDomain`, () => {
      const errs = fieldsOf(schema, { code: nonMember });
      expect(errs).not.toBeNull();
      expect(errs?.[0]).toMatchObject({
        field: 'code',
        code: 'value_domain',
        constraint: { valueDomain: domain },
      });
    });

    it(`${domain}: refuses on update as well as insert`, () => {
      const errs = fieldsOf(schema, { code: nonMember }, 'update');
      expect(errs?.[0]).toMatchObject({ field: 'code', code: 'value_domain' });
    });
  }

  it('the refusal message names the standard and interpolates the offending value', () => {
    const errs = fieldsOf(
      { fields: { code: { type: 'text', label: 'Country', valueDomain: 'iso_3166_alpha2' } } },
      { code: 'ZZ' },
    );
    // The finer per-domain template (`value_domain_iso_3166_alpha2`) spells the
    // standard out for a human; the WIRE code stays the catalog member. A
    // template whose `{{value}}` went uninterpolated would ship the literal
    // placeholder to the user, so the assertion is on the rendered sentence.
    expect(errs?.[0]?.message).toBe(
      'Country must be a valid ISO 3166-1 alpha-2 country code, e.g. CH (got "ZZ")',
    );
    expect(errs?.[0]?.message).not.toContain('{{');
  });

  it('a text field with NO declared domain accepts anything (the key is opt-in)', () => {
    const schema = { fields: { code: { type: 'text' } } };
    expect(fieldsOf(schema, { code: 'ZZ' })).toBeNull();
  });

  /**
   * WRITTEN VALUE ONLY — the `min`/`max`/`maxLength` transition-gate class. A
   * value stored before the domain was declared is never re-read, so an edit
   * of ANOTHER field on that record must not 400. This is the spec's stated
   * semantics and the reason the check hangs off the supplied value rather
   * than off the record.
   */
  it('unchanged-on-read: a stored non-member survives an edit of another field', () => {
    const schema = {
      fields: {
        code: { type: 'text', valueDomain: 'iso_3166_alpha2' },
        note: { type: 'text' },
      },
    };
    // The PATCH touches `note` only; `code` still holds the legacy 'ZZ'.
    expect(fieldsOf(schema, { note: 'edited' }, 'update')).toBeNull();
  });

  /**
   * Absent / empty follows the field's `required` handling, NOT this check —
   * `''` on a required field is a `required` error, and on an optional field it
   * is simply nothing to judge. A membership test that fired on emptiness would
   * make every optional domain field required by the back door.
   */
  it('an empty value on an OPTIONAL domain field is admitted, not judged for membership', () => {
    const schema = { fields: { code: { type: 'text', valueDomain: 'iso_3166_alpha2' } } };
    expect(fieldsOf(schema, { code: '' })).toBeNull();
    expect(fieldsOf(schema, { code: null })).toBeNull();
  });

  it('an empty value on a REQUIRED domain field fails as `required`, never as `value_domain`', () => {
    const schema = {
      fields: { code: { type: 'text', required: true, valueDomain: 'iso_3166_alpha2' } },
    };
    const errs = fieldsOf(schema, { code: '' });
    expect(errs?.[0]).toMatchObject({ field: 'code', code: 'required' });
  });

  /**
   * The declared bounds still win. `maxLength` / `minLength` are checked first
   * in the same branch, so a value that is both over-long and a non-member
   * reports the bound — one error per field, first rule wins, as everywhere
   * else in this validator.
   */
  it('a declared maxLength is still reported first for a value that violates both', () => {
    const schema = {
      fields: { code: { type: 'text', maxLength: 2, valueDomain: 'iso_3166_alpha2' } },
    };
    const errs = fieldsOf(schema, { code: 'ZZZZ' });
    expect(errs?.[0]).toMatchObject({ field: 'code', code: 'max_length' });
  });

  /**
   * CONTROL — the applicability door is the spec's `VALUE_DOMAIN_FIELD_TYPES`,
   * and this seam reads that same constant rather than firing on every
   * bounded-string type that happens to carry the key. `FieldSchema` refuses
   * `valueDomain` outside the set at parse (a located `custom` issue at
   * `[valueDomain]`), so authored metadata can never reach here in this shape;
   * a hand-built runtime schema can, and the spec's own refusal message states
   * what happens then — "the write-time validator applies `valueDomain` to
   * exactly those types". Enforcing on the other eleven would make that
   * sentence false and would fork the two seams into two opinions, the drift
   * #11875 closed for `maxLength`.
   */
  it("a bounded-string type OUTSIDE the domain set is not judged — the two seams read one constant", () => {
    const schema = { fields: { body: { type: 'textarea', valueDomain: 'iso_3166_alpha2' } } };
    expect(fieldsOf(schema, { body: 'ZZ' })).toBeNull();
  });
});
