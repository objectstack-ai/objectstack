// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #2486 — `__search` companion column: provisioning seam, eligibility gate,
 * registry integration, and query-time OR-ing in expandSearchToFilter.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { resolveDisplayField } from '@objectstack/spec/data';
import {
  SEARCH_COMPANION_FIELD,
  provisionSearchCompanion,
  resolveSearchCompanionSources,
  isCompanionSourceEligible,
  isCompanionMatchableTerm,
  isPrimaryKeyField,
  containsCJK,
} from './search-companion';
import { expandSearchToFilter, resolveSearchFields } from './search-filter';
import { SchemaRegistry } from './registry';

const contact = (): ServiceObject => ({
  name: 'crm_contact',
  fields: {
    name: { type: 'text', label: 'Name' },
    email: { type: 'email' },
    notes: { type: 'textarea' },
  },
});

describe('isCompanionSourceEligible (ADR-0061 D5 security gate)', () => {
  it('accepts plain stored text-ish fields', () => {
    expect(isCompanionSourceEligible({ type: 'text' })).toBe(true);
    expect(isCompanionSourceEligible({ type: 'textarea' })).toBe(true);
    expect(isCompanionSourceEligible({ type: 'email' })).toBe(true);
  });

  it('rejects secret-ish / non-text / virtual types (fail-closed)', () => {
    for (const type of ['secret', 'password', 'lookup', 'select', 'formula', 'json', undefined]) {
      expect(isCompanionSourceEligible({ type })).toBe(false);
    }
  });

  it('rejects hidden fields and fields with field-level read restrictions', () => {
    expect(isCompanionSourceEligible({ type: 'text', hidden: true })).toBe(false);
    expect(isCompanionSourceEligible({ type: 'text', requiredPermissions: ['view_pii'] })).toBe(false);
    expect(isCompanionSourceEligible({ type: 'text', requiredPermissions: [] })).toBe(true);
  });
});

describe('resolveSearchCompanionSources', () => {
  it('returns the resolved display/name field only', () => {
    expect(resolveSearchCompanionSources(contact())).toEqual(['name']);
  });

  it('honors an explicit nameField pointer', () => {
    const schema = {
      name: 'crm_ticket',
      nameField: 'subject',
      fields: { subject: { type: 'text' }, name: { type: 'text' } },
    };
    expect(resolveSearchCompanionSources(schema)).toEqual(['subject']);
  });

  it('returns [] when the name source is ineligible or absent', () => {
    expect(resolveSearchCompanionSources({
      name: 'x',
      nameField: 'code',
      fields: { code: { type: 'text', requiredPermissions: ['view_secret'] } },
    })).toEqual([]);
    expect(resolveSearchCompanionSources({
      name: 'junction',
      fields: { left_id: { type: 'lookup' }, right_id: { type: 'lookup' } },
    })).toEqual([]);
    expect(resolveSearchCompanionSources(undefined)).toEqual([]);
  });
});

describe('provisionSearchCompanion', () => {
  it('appends the hidden companion column for an eligible object', () => {
    const out = provisionSearchCompanion(contact());
    const col = out.fields[SEARCH_COMPANION_FIELD] as any;
    expect(col).toBeDefined();
    expect(col.type).toBe('text');
    expect(col.hidden).toBe(true);
    expect(col.readonly).toBe(true);
    expect(col.system).toBe(true);
    expect(col.searchable).toBe(false);
    // [#7561] Was `expect(col.index).toBe(true)` — this line pinned the DEFECT
    // rather than the contract. `index` is not a `FieldSchema` key (removed in
    // the 16.x line, #2377 / ADR-0049, because a field-level index flag built no
    // index), and `FieldSchema` is a `strictObject`, so stamping it badged every
    // object carrying a companion `_diagnostics: { valid: false }` and drove
    // `GET /api/v1/meta/diagnostics` to 94/94 INVALID. The key is now absent,
    // and no index is declared in its place: this column's only reader is a
    // `$contains`, which no B-tree serves. See the docblock in
    // `search-companion.ts` and the pins in
    // `stamped-system-fields-spec-conformance.test.ts`.
    expect(col.index).toBeUndefined();
    expect(Object.keys(col)).not.toContain('index');
  });

  it('is idempotent and skips ineligible / opted-out objects unchanged', () => {
    const once = provisionSearchCompanion(contact());
    expect(provisionSearchCompanion(once)).toBe(once);

    const titleless = { name: 'junction', fields: { a_id: { type: 'lookup' } } };
    expect(provisionSearchCompanion(titleless)).toBe(titleless);

    const optedOut = { ...contact(), searchable: false };
    expect(provisionSearchCompanion(optedOut)).toBe(optedOut);
  });
});

describe('SchemaRegistry integration (compile-time seam)', () => {
  it('provisions the companion on registered objects when searchCompanion is on', () => {
    const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: true });
    registry.registerObject(contact(), 'test-pkg', 'crm');
    const schema = registry.getObject('crm_contact')!;
    expect(schema.fields![SEARCH_COMPANION_FIELD]).toBeDefined();
    expect((schema.fields![SEARCH_COMPANION_FIELD] as any).hidden).toBe(true);
  });

  it('does NOT provision when the flag is off (default) — pure additive', () => {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.registerObject(contact(), 'test-pkg', 'crm');
    expect(registry.getObject('crm_contact')!.fields![SEARCH_COMPANION_FIELD]).toBeUndefined();
  });

  it('skips objects with no eligible name source even when on', () => {
    const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: true });
    registry.registerObject(
      { name: 'crm_link', systemFields: false, fields: { a_id: { type: 'lookup' }, b_id: { type: 'lookup' } } } as any,
      'test-pkg',
      'crm',
    );
    expect(registry.getObject('crm_link')!.fields![SEARCH_COMPANION_FIELD]).toBeUndefined();
  });
});

describe('expandSearchToFilter with companion column (query-time, additive)', () => {
  const fields = provisionSearchCompanion(contact()).fields as any;

  it('ORs the companion clause for latin terms (lowercased)', () => {
    const filter = expandSearchToFilter('ZhangWei', { fields });
    // [#7641] The two clauses use DIFFERENT operators, on purpose. The
    // companion is a normalized blob — lowercase by construction on the column
    // side and lowercased here on the term side — so case-SENSITIVE
    // `$contains` over two already-folded values is exact.
    expect(filter.$or).toContainEqual({ [SEARCH_COMPANION_FIELD]: { $contains: 'zhangwei' } });
    // The SOURCE field compares against raw stored text, so it needs the
    // folding operator; it carries the term at the caller's own casing.
    expect(filter.$or).toContainEqual({ name: { $icontains: 'ZhangWei' } });
  });

  it('skips the companion clause for CJK and letterless terms', () => {
    const cjk = expandSearchToFilter('张伟', { fields });
    expect(JSON.stringify(cjk)).not.toContain(SEARCH_COMPANION_FIELD);
    const digits = expandSearchToFilter('12345', { fields });
    expect(JSON.stringify(digits)).not.toContain(SEARCH_COMPANION_FIELD);
  });

  it('applies per-term for multi-term queries (terms stay AND-ed)', () => {
    const filter = expandSearchToFilter('zw 张', { fields });
    expect(filter.$and).toHaveLength(2);
    expect(JSON.stringify(filter.$and[0])).toContain('"__search":{"$contains":"zw"}');
    expect(JSON.stringify(filter.$and[1])).not.toContain(SEARCH_COMPANION_FIELD);
  });

  it('emits no companion clause for objects without the column', () => {
    const filter = expandSearchToFilter('zhangwei', { fields: contact().fields as any });
    expect(JSON.stringify(filter)).not.toContain(SEARCH_COMPANION_FIELD);
  });

  it('keeps resolveSearchFields untouched — the companion is invisible to clients', () => {
    const resolved = resolveSearchFields({ fields });
    expect(resolved).not.toContain(SEARCH_COMPANION_FIELD);
    // …and a client cannot force it in via the $searchFields override.
    const forced = resolveSearchFields({ fields, requestedFields: [SEARCH_COMPANION_FIELD] });
    expect(forced).not.toContain(SEARCH_COMPANION_FIELD);
  });
});

/**
 * [#21880] The companion clause follows the effective search-field set.
 *
 * The companion is a normalized copy of its source fields, so it may join a
 * search only when every field it mirrors is inside the set
 * `resolveSearchFields` computed. A field-narrowed search that leaves a
 * mirrored field out gets no companion clause; a search with no narrowing
 * keeps it, so recall is unchanged there.
 */
describe('[#21880] the companion clause follows the effective search-field set', () => {
  // `crm_contact`: the companion mirrors `name` (the derived display field).
  const fields = provisionSearchCompanion(contact()).fields as any;
  const companionClause = (term: string) => ({ [SEARCH_COMPANION_FIELD]: { $contains: term } });

  it('premise: the companion is provisioned and mirrors exactly `name`', () => {
    expect(fields[SEARCH_COMPANION_FIELD]).toBeDefined();
    expect(resolveSearchCompanionSources({ name: 'crm_contact', fields })).toEqual(['name']);
  });

  describe('(a) a field-narrowed search that leaves the mirrored field out gets no companion clause', () => {
    it('a `$searchFields` override without the mirrored field', () => {
      expect(expandSearchToFilter('zhangwei', { fields, requestedFields: ['email'] })).toEqual({
        $or: [{ email: { $icontains: 'zhangwei' } }],
      });
      // The comma-separated spelling a URL query parameter arrives as.
      expect(expandSearchToFilter('zhangwei', { fields, requestedFields: 'email,notes' })).toEqual({
        $or: [{ email: { $icontains: 'zhangwei' } }, { notes: { $icontains: 'zhangwei' } }],
      });
    });

    it('the narrowing carried on the search term itself (`{ query, fields }`)', () => {
      expect(expandSearchToFilter({ query: 'zhangwei', fields: ['notes'] }, { fields })).toEqual({
        $or: [{ notes: { $icontains: 'zhangwei' } }],
      });
    });

    it('a declared `searchableFields` set without the mirrored field', () => {
      expect(expandSearchToFilter('zhangwei', { fields, searchableFields: ['email'] })).toEqual({
        $or: [{ email: { $icontains: 'zhangwei' } }],
      });
    });

    it('every term of a multi-term search', () => {
      const filter = expandSearchToFilter('zhang wei', { fields, requestedFields: ['email'] });
      expect(filter).toEqual({
        $and: [
          { $or: [{ email: { $icontains: 'zhang' } }] },
          { $or: [{ email: { $icontains: 'wei' } }] },
        ],
      });
    });

    it('reads the REAL source: an explicit `nameField` pointer moves what the companion mirrors', () => {
      // `crm_ticket` names `subject` as its title, so the companion mirrors
      // `subject` — not `name`, although a `name` field exists.
      const ticket = provisionSearchCompanion({
        name: 'crm_ticket',
        nameField: 'subject',
        fields: { subject: { type: 'text' }, name: { type: 'text' } },
      });
      const ticketFields = ticket.fields as any;
      expect(resolveSearchCompanionSources(ticket)).toEqual(['subject']);

      const withoutSubject = expandSearchToFilter('zhangwei', {
        fields: ticketFields, displayField: 'subject', requestedFields: ['name'],
      });
      expect(withoutSubject).toEqual({ $or: [{ name: { $icontains: 'zhangwei' } }] });

      const withSubject = expandSearchToFilter('zhangwei', {
        fields: ticketFields, displayField: 'subject', requestedFields: ['subject'],
      });
      expect(withSubject.$or).toContainEqual(companionClause('zhangwei'));
    });
  });

  describe('(b) a search with no narrowing keeps the companion clause (recall unchanged)', () => {
    it('the auto-default set, which leads with the mirrored field', () => {
      expect(expandSearchToFilter('ZhangWei', { fields })).toEqual({
        $or: [
          { name: { $icontains: 'ZhangWei' } },
          { email: { $icontains: 'ZhangWei' } },
          { notes: { $icontains: 'ZhangWei' } },
          companionClause('zhangwei'),
        ],
      });
    });

    it('a narrowed set that still holds the mirrored field', () => {
      expect(expandSearchToFilter('zw', { fields, requestedFields: ['name'] })).toEqual({
        $or: [{ name: { $icontains: 'zw' } }, companionClause('zw')],
      });
    });

    it('the gate reads the RESOLVED set: a request naming no allowed field falls back to the full set', () => {
      // `resolveSearchFields` drops unknown names and falls back to the
      // allowed set when none survives — so the effective set holds `name`.
      const filter = expandSearchToFilter('zw', { fields, requestedFields: ['no_such_field'] });
      expect(filter.$or).toContainEqual(companionClause('zw'));
    });
  });

  describe('(c) a CJK term still skips the companion clause, as before', () => {
    it('with and without narrowing', () => {
      expect(expandSearchToFilter('张伟', { fields })).toEqual({
        $or: [
          { name: { $icontains: '张伟' } },
          { email: { $icontains: '张伟' } },
          { notes: { $icontains: '张伟' } },
        ],
      });
      expect(expandSearchToFilter('张伟', { fields, requestedFields: ['name'] })).toEqual({
        $or: [{ name: { $icontains: '张伟' } }],
      });
    });
  });
});

describe('containsCJK / isCompanionMatchableTerm', () => {
  it('detects Han characters', () => {
    expect(containsCJK('张伟')).toBe(true);
    expect(containsCJK('Zhang Wei')).toBe(false);
    expect(containsCJK(42)).toBe(false);
  });

  it('classifies companion-matchable terms', () => {
    expect(isCompanionMatchableTerm('zhangwei')).toBe(true);
    expect(isCompanionMatchableTerm('zw')).toBe(true);
    expect(isCompanionMatchableTerm('张伟')).toBe(false);
    expect(isCompanionMatchableTerm('zh张')).toBe(false);
    expect(isCompanionMatchableTerm('123')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [commit 2570ab05c] The primary key is never a companion source.
//
// The two blocks below are a matched pair and are meant to be read together:
// the first is the NEGATIVE control (the defect — it fails on the pre-fix
// source), the second is the POSITIVE control (the capability survives — it
// fails if the refusal over-reaches).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The measured shape: a platform table whose only title-eligible column IS its
 * primary key. `id` is declared first, so ADR-0079's derivation reaches tier 3
 * ("first title-eligible field by declaration order") and lands on it — which
 * is how `sys_jwks`, `sys_secret`, `sys_oauth_access_token` and 17 more came to
 * carry a companion column their values can never fill.
 */
const pkOnly = (): any => ({
  name: 'sys_jwks',
  fields: {
    id: { type: 'text', label: 'ID', readonly: true },
    created_at: { type: 'datetime' },
    expires_at: { type: 'datetime' },
  },
});

/**
 * The shape the registry ACTUALLY hands this seam. `materializeBaseLayer` runs
 * `provisionPrimary(schema, { synthesize: false })` first — contractual order —
 * so the derived fallback has already been written down as an explicit
 * `nameField` pointer by the time provisioning asks. A refusal keyed on "the
 * display field resolved by fallback" could not see any difference here, which
 * is why the refusal is keyed on the field's role instead.
 */
const pkOnlyDesignated = (): any => ({ ...pkOnly(), nameField: 'id' });

describe('[#10290] negative control — the primary key is never a companion source', () => {
  it('refuses a tier-3 derived display field that is the primary key', () => {
    expect(resolveDisplayField(pkOnly())).toBe('id'); // ADR-0079 is unchanged…
    expect(resolveSearchCompanionSources(pkOnly())).toEqual([]); // …the companion declines it
  });

  it('refuses it just the same once `provisionPrimary` has written it down as `nameField`', () => {
    expect(resolveSearchCompanionSources(pkOnlyDesignated())).toEqual([]);
  });

  it('refuses the `_id` spelling of the same address', () => {
    expect(resolveSearchCompanionSources({
      name: 'sys_legacy',
      nameField: '_id',
      fields: { _id: { type: 'text' }, created_at: { type: 'datetime' } },
    })).toEqual([]);
  });

  it('declares no `__search` column on such an object (returns it by reference)', () => {
    const before = pkOnly();
    expect(provisionSearchCompanion(before)).toBe(before);
    expect(before.fields[SEARCH_COMPANION_FIELD]).toBeUndefined();

    const designated = pkOnlyDesignated();
    expect(provisionSearchCompanion(designated)).toBe(designated);
    expect(designated.fields[SEARCH_COMPANION_FIELD]).toBeUndefined();
  });

  it('SchemaRegistry: registering one provisions no companion, and ADR-0079 still designates the title', () => {
    const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: true });
    registry.registerObject(pkOnly(), 'test-pkg', 'sys');
    const schema = registry.getObject('sys_jwks')!;
    expect(schema.fields![SEARCH_COMPANION_FIELD]).toBeUndefined();
    // The title contract is INTERPRETED, not amended: the pointer is still set.
    expect((schema as any).nameField).toBe('id');
  });

  it('isPrimaryKeyField answers for the address spellings only', () => {
    expect(isPrimaryKeyField('id')).toBe(true);
    expect(isPrimaryKeyField('_id')).toBe(true);
    expect(isPrimaryKeyField(undefined)).toBe(false);
    expect(isPrimaryKeyField('')).toBe(false);
  });
});

describe('[#10290] positive control — objects with a real title keep the companion', () => {
  /** A contact as the platform really registers it: `id` present, `name` too. */
  const contactWithId = (): any => ({
    name: 'crm_contact',
    fields: {
      id: { type: 'text', label: 'ID', readonly: true },
      name: { type: 'text', label: 'Name' },
      email: { type: 'email' },
    },
  });

  it('an object carrying an `id` field still gets its companion from the name field', () => {
    expect(resolveSearchCompanionSources(contactWithId())).toEqual(['name']);
    const out = provisionSearchCompanion(contactWithId());
    expect(out.fields[SEARCH_COMPANION_FIELD]).toBeDefined();
  });

  it('a plain text display field that is not named `name`/`title` is still accepted', () => {
    // Explicit pointer …
    expect(resolveSearchCompanionSources({
      name: 'crm_ticket',
      nameField: 'subject',
      fields: { id: { type: 'text' }, subject: { type: 'text' } },
    })).toEqual(['subject']);
    // … and a tier-3 DERIVED text column (the same derivation path the negative
    // control exercises), so the refusal cannot be "all `type: 'text'` sources".
    expect(resolveSearchCompanionSources({
      name: 'crm_code',
      fields: { code: { type: 'text' }, note: { type: 'textarea' } },
    })).toEqual(['code']);
  });

  it('a field whose NAME merely contains "id" is not the address', () => {
    for (const fname of ['identifier', 'id_card', 'bid', 'valid_name', 'external_id_label']) {
      expect(isPrimaryKeyField(fname)).toBe(false);
      expect(resolveSearchCompanionSources({
        name: 'crm_thing',
        nameField: fname,
        fields: { [fname]: { type: 'text' } },
      })).toEqual([fname]);
    }
  });

  it('SchemaRegistry: a titled object is still provisioned end-to-end', () => {
    const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: true });
    registry.registerObject(contactWithId(), 'test-pkg', 'crm');
    const schema = registry.getObject('crm_contact')!;
    expect(schema.fields![SEARCH_COMPANION_FIELD]).toBeDefined();
    expect((schema.fields![SEARCH_COMPANION_FIELD] as any).hidden).toBe(true);
  });

  it('the query-time OR clause still fires for a companion-bearing object', () => {
    const fields = provisionSearchCompanion(contactWithId()).fields as any;
    const filter = expandSearchToFilter('zhangwei', { fields });
    expect(filter.$or).toContainEqual({ [SEARCH_COMPANION_FIELD]: { $contains: 'zhangwei' } });
  });
});
