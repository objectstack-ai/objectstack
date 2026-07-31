// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateSearchableFields,
  SEARCHABLE_FIELD_UNKNOWN,
} from './validate-searchable-fields.js';

/**
 * The drift this rule exists for: `email` was renamed to `billing_email` and
 * the old name stayed behind in `searchableFields`. Zod-valid, shipped, and
 * pointing at a column that no longer exists.
 */
const staleStack = {
  objects: [
    {
      name: 'crm_account',
      fields: {
        name: { type: 'text', label: 'Name' },
        billing_email: { type: 'email', label: 'Billing Email' },
        status: { type: 'select', label: 'Status' },
      },
      searchableFields: ['name', 'email', 'status'],
    },
  ],
};

/** The same object after the rename was carried through. */
const cleanStack = {
  objects: [
    {
      name: 'crm_account',
      fields: {
        name: { type: 'text', label: 'Name' },
        billing_email: { type: 'email', label: 'Billing Email' },
        status: { type: 'select', label: 'Status' },
      },
      searchableFields: ['name', 'billing_email', 'status'],
    },
  ],
};

describe('validateSearchableFields — object declaration', () => {
  it('flags an entry that names no field on the object', () => {
    const findings = validateSearchableFields(staleStack);

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNKNOWN);
    expect(findings[0].where).toBe('object "crm_account"');
    // The index is part of the path so the author can go straight to the entry.
    expect(findings[0].path).toBe('objects[0].searchableFields[1]');
    expect(findings[0].message).toContain('"email"');
    expect(findings[0].message).toContain('crm_account');
  });

  it('gates the build (error), unlike the advisory field-existence rules', () => {
    // A stale entry either narrows the searched set below the declaration or —
    // once every entry is stale — falls through to the auto-default and
    // searches a set nobody wrote. Neither is something a yellow line should
    // ship. Pinned because a downgrade to `warning` would be invisible: `os
    // validate` only exits non-zero on `error`.
    expect(validateSearchableFields(staleStack)[0].severity).toBe('error');
  });

  it('explains the fix and names the fields that do exist', () => {
    const [finding] = validateSearchableFields(staleStack);

    expect(finding.hint).toContain('billing_email');
    // The declaration is echoed verbatim by clients as `$searchFields`, so the
    // hint must say why this is not merely a quietly narrowed search.
    expect(finding.hint).toContain('400 INVALID_FIELD');
  });

  it('suggests the renamed field when the stale name is close to a real one', () => {
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { billing_email: { type: 'email' } },
          searchableFields: ['biling_email'],
        },
      ],
    });

    expect(findings[0].message).toContain('Did you mean "billing_email"?');
  });

  it('reports every stale entry, not just the first', () => {
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' } },
          searchableFields: ['name', 'email', 'phone'],
        },
      ],
    });

    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].searchableFields[1]',
      'objects[0].searchableFields[2]',
    ]);
  });

  it('passes a declaration whose every entry resolves', () => {
    expect(validateSearchableFields(cleanStack)).toEqual([]);
  });

  it('reads the legacy array field map as well as the name-keyed one', () => {
    const asArrayFields = {
      objects: [
        {
          name: 'crm_account',
          fields: [
            { name: 'name', type: 'text' },
            { name: 'billing_email', type: 'email' },
          ],
          searchableFields: ['billing_email'],
        },
      ],
    };

    expect(validateSearchableFields(asArrayFields)).toEqual([]);
  });
});

describe('validateSearchableFields — what it deliberately does not flag', () => {
  it('accepts registry-injected system columns absent from authored fields', () => {
    // `created_at` / `owner_id` are injected by the objectql registry, so they
    // are searchable at runtime while never appearing in `fields`. Flagging
    // them would be the false positive that makes authors stop reading lint.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' } },
          searchableFields: ['name', 'created_at', 'owner_id'],
        },
      ],
    });

    expect(findings).toEqual([]);
  });

  it('leaves an object with no authored field map alone', () => {
    // External objects and datasource-introspected schemas resolve their
    // columns at runtime; there is nothing here to judge against.
    const findings = validateSearchableFields({
      objects: [
        { name: 'external_invoice', external: { datasource: 'erp' }, searchableFields: ['doc_no'] },
      ],
    });

    expect(findings).toEqual([]);
  });

  it('does not flag a field that exists but is an odd search target', () => {
    // An explicit `searchableFields` is authoritative — the engine scans
    // exactly what it names — so declaring a json column is a choice, not
    // drift. This rule answers existence only.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' }, payload: { type: 'json' } },
          searchableFields: ['name', 'payload'],
        },
      ],
    });

    expect(findings).toEqual([]);
  });

  it('ignores a non-string entry — that is a shape error the schema owns', () => {
    const findings = validateSearchableFields({
      objects: [
        { name: 'crm_account', fields: { name: { type: 'text' } }, searchableFields: [null, 42] },
      ],
    });

    expect(findings).toEqual([]);
  });

  it('returns nothing for an empty stack, a missing declaration, or an empty one', () => {
    expect(validateSearchableFields({})).toEqual([]);
    expect(validateSearchableFields({ objects: [{ name: 'a', fields: { n: { type: 'text' } } }] })).toEqual([]);
    expect(
      validateSearchableFields({
        objects: [{ name: 'a', fields: { n: { type: 'text' } }, searchableFields: [] }],
      }),
    ).toEqual([]);
  });
});

describe('validateSearchableFields — dotted paths', () => {
  it('flags a related-record path, which search cannot resolve', () => {
    // Every sibling rule skips `owner_id.name` because the query engine
    // resolves the traversal. Search does not: `resolveSearchFields` matches
    // the field map by exact string, so a dotted entry is dropped exactly like
    // a typo — and it is the spelling most likely borrowed from `select`.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' }, owner_id: { type: 'lookup', reference: 'sys_user' } },
          searchableFields: ['name', 'owner_id.name'],
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].searchableFields[1]');
    expect(findings[0].hint).toContain("scans this object's own columns");
  });
});

describe('validateSearchableFields — list views that narrow the set', () => {
  const objectWithFields = {
    name: 'crm_account',
    fields: { name: { type: 'text' }, billing_email: { type: 'email' } },
  };

  it("flags a stale entry on an object's built-in named list view", () => {
    const findings = validateSearchableFields({
      objects: [
        { ...objectWithFields, listViews: { all: { type: 'grid', searchableFields: ['email'] } } },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].listViews.all.searchableFields[0]');
    expect(findings[0].where).toBe('object "crm_account" › listViews.all');
  });

  it('flags a stale entry on a defineView default list, bound via data.object', () => {
    const findings = validateSearchableFields({
      objects: [objectWithFields],
      views: [
        {
          name: 'account_views',
          list: {
            type: 'grid',
            data: { provider: 'object', object: 'crm_account' },
            searchableFields: ['name', 'email'],
          },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].list.searchableFields[1]');
    expect(findings[0].where).toBe('view "account_views" › list');
  });

  it('flags a stale entry on a named listViews entry', () => {
    const findings = validateSearchableFields({
      objects: [objectWithFields],
      views: [
        {
          objectName: 'crm_account',
          listViews: { active: { type: 'grid', searchableFields: ['email'] } },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].listViews.active.searchableFields[0]');
  });

  it('passes list views whose narrowing resolves', () => {
    const findings = validateSearchableFields({
      objects: [
        {
          ...objectWithFields,
          listViews: { all: { type: 'grid', searchableFields: ['billing_email'] } },
        },
      ],
      views: [
        {
          objectName: 'crm_account',
          list: { type: 'grid', searchableFields: ['name'] },
          listViews: { active: { type: 'grid', searchableFields: ['name', 'billing_email'] } },
        },
      ],
    });

    expect(findings).toEqual([]);
  });

  it('skips a view bound to an object this stack does not define', () => {
    // The object may come from another package; a field map we cannot see
    // cannot be judged — the same skip the page/flow/widget rules take.
    const findings = validateSearchableFields({
      objects: [objectWithFields],
      views: [
        {
          name: 'foreign',
          list: {
            type: 'grid',
            data: { provider: 'object', object: 'pkg_contract' },
            searchableFields: ['no_such_field'],
          },
        },
      ],
    });

    expect(findings).toEqual([]);
  });
});
