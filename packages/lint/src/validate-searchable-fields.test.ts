// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveSearchFields } from '@objectstack/spec/data';
import {
  validateSearchableFields,
  checkSearchableFieldList,
  indexObjectSearchTargets,
  SEARCHABLE_FIELD_UNKNOWN,
  SEARCHABLE_FIELD_UNSEARCHABLE,
  SEARCHABLE_FIELD_UNPROVISIONED,
} from './validate-searchable-fields.js';
import { indexUnprovisionedAnchors } from './system-fields.js';

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
    // The prescription must be a STORED field — a `formula` field is virtual
    // (no driver materializes a column for it), so it can never be scanned.
    expect(findings[0].hint).toContain('copy the value onto a stored text field');
    expect(findings[0].hint).not.toContain('formula');
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

  // ── [#9313] the SELF rung: a flattened standalone list overlay ──
  //
  // The `PUT /api/v1/meta/view` shape — a raw ListView config at the TOP of
  // the `views[]` entry (`object` + `viewKind: 'list'` required, #7741). The
  // runtime publish gate snapshots a `view` write as `views: [item]`; without
  // this rung the #9313 dispatch widening would be a silent no-op.

  it('flags a stale entry on a flattened list overlay\'s top-level set (#9313)', () => {
    const findings = validateSearchableFields({
      objects: [objectWithFields],
      views: [
        {
          name: 'crm_account.custom',
          object: 'crm_account',
          viewKind: 'list',
          type: 'grid',
          columns: ['name'],
          searchableFields: ['name', 'email'],
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNKNOWN);
    expect(findings[0].path).toBe('views[0].searchableFields[1]');
    expect(findings[0].where).toBe('view "crm_account.custom" (flattened list overlay)');
  });

  it('judges an overlay\'s set as a NARROWING — the #4830 admissibility applies (#9313)', () => {
    // A lookup-typed entry in an overlay's set is echoed as the
    // `$searchFields` override and refused by the #4254 ingress gate on every
    // toolbar search — the same runtime judgment every list-view surface gets.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_case',
          fields: { name: { type: 'text' }, account_id: { type: 'lookup' } },
        },
      ],
      views: [
        {
          name: 'crm_case.mine',
          object: 'crm_case',
          viewKind: 'list',
          searchableFields: ['name', 'account_id'],
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(findings[0].path).toBe('views[0].searchableFields[1]');
  });

  it('does NOT read a ViewItem record\'s top level as an overlay (#9313)', () => {
    // The record shape carries its set in `config` — a different rung,
    // deliberately not walked (recorded scope; see the sort twin's module note).
    const findings = validateSearchableFields({
      objects: [objectWithFields],
      views: [
        {
          name: 'crm_account.pipeline',
          object: 'crm_account',
          viewKind: 'list',
          config: { type: 'grid', columns: ['name'], searchableFields: ['email'] },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('flags a lookup entry the runtime would refuse — the #4830 defect', () => {
    // The issue's repro verbatim: `searchableFields: ['name', '<lookup>']` on a
    // view, validate all green, first keystroke in the toolbar search → the
    // whole query 400s (INVALID_FIELD) for every role. The runtime judgment
    // is `resolveSearchFieldResolution` (@objectstack/spec/data); this rule
    // consults the same function, so declared = enforced.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'ehr_task',
          fields: {
            name: { type: 'text' },
            project_id: { type: 'lookup', reference: 'ehr_project' },
          },
          listViews: { all: { type: 'grid', searchableFields: ['name', 'project_id'] } },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('objects[0].listViews.all.searchableFields[1]');
    expect(findings[0].message).toContain("type 'lookup'");
    expect(findings[0].message).toContain('400 INVALID_FIELD');
    // The lookup-specific prescription: search cannot cross objects, so the
    // related record's title must be mirrored onto a local STORED text field —
    // never a `formula` field, which is virtual and materializes no column.
    expect(findings[0].hint).toContain('mirror');
    expect(findings[0].hint).toContain('mirror it onto a stored text field');
    expect(findings[0].hint).not.toContain('formula');
  });

  it('flags a real field outside the object\'s declared searchableFields', () => {
    // Runtime parity, declared branch: the object declares the canonical set,
    // and the #4254 gate refuses a `$searchFields` entry outside it even when
    // the field exists and is text-like.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: {
            name: { type: 'text' },
            billing_email: { type: 'email' },
            notes: { type: 'textarea' },
          },
          searchableFields: ['name', 'billing_email'],
          listViews: { all: { type: 'grid', searchableFields: ['notes'] } },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(findings[0].message).toContain('name, billing_email');
    expect(findings[0].hint).toContain('crm_account.searchableFields');
  });

  it('passes a view entry of odd type once the object declares it searchable', () => {
    // The runtime's declared branch filters by EXISTENCE, never by type: a
    // json/lookup column declared on the OBJECT is honored by the engine and
    // admitted by the gate, so the view echoing it must stay green — flagging
    // it would reject metadata the runtime accepts.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' }, payload: { type: 'json' } },
          searchableFields: ['name', 'payload'],
          listViews: { all: { type: 'grid', searchableFields: ['payload'] } },
        },
      ],
    });

    expect(findings).toEqual([]);
  });

  it('flags a hidden field in a view narrowing (auto-default excludes it)', () => {
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' }, secret_note: { type: 'text', hidden: true } },
          listViews: { all: { type: 'grid', searchableFields: ['secret_note'] } },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(findings[0].message).toContain('hidden');
  });

  it('checks defineView list and named listViews the same way', () => {
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' }, owner_ref: { type: 'lookup', reference: 'sys_user' } },
        },
      ],
      views: [
        {
          objectName: 'crm_account',
          list: { type: 'grid', searchableFields: ['owner_ref'] },
          listViews: { active: { type: 'grid', searchableFields: ['owner_ref'] } },
        },
      ],
    });

    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [SEARCHABLE_FIELD_UNSEARCHABLE, 'views[0].list.searchableFields[0]'],
      [SEARCHABLE_FIELD_UNSEARCHABLE, 'views[0].listViews.active.searchableFields[0]'],
    ]);
  });

  it('keeps runtime parity when the object declares system columns searchable', () => {
    // The runtime resolves the declared branch against the REGISTRY map, so
    // `searchableFields: ['created_at']` is a non-empty declared set there —
    // NOT a fall-through to the auto-default. A view entry outside that set
    // must be flagged the way the gate refuses it, even though `created_at`
    // is invisible to the authored field map.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'audit_log',
          fields: { name: { type: 'text' }, detail: { type: 'textarea' } },
          searchableFields: ['created_at'],
          listViews: { all: { type: 'grid', searchableFields: ['detail'] } },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(findings[0].message).toContain('created_at');
  });

  it('leaves a system column in a view narrowing alone (registry meta invisible)', () => {
    // `created_at` in a narrowing would be refused by the runtime, but its
    // registry-side metadata is not visible to the linter — a judgment here
    // risks the false positive ADR-0072 D1 forbids, so it is a documented
    // missed finding instead.
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' } },
          listViews: { all: { type: 'grid', searchableFields: ['name', 'created_at'] } },
        },
      ],
    });

    expect(findings).toEqual([]);
  });

  it('does not type-check the object\'s own canonical set (runtime honors it)', () => {
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: { name: { type: 'text' }, owner_ref: { type: 'lookup', reference: 'sys_user' } },
          searchableFields: ['name', 'owner_ref'],
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

/**
 * [#6675] Skill-parity — `skills/objectstack-ui/SKILL.md` › "Toolbar Search
 * (`searchableFields`, ADR-0061)" quotes this rule's two diagnostics verbatim
 * and states three boundaries as fact. The skill ships to third parties via
 * `npx skills add`, so a reader who follows it is following THIS code; if the
 * wording or a verdict moves and nobody re-reads the skill, the published text
 * teaches a rule the platform no longer has.
 *
 * The same reason `validate-rls-predicate-enforceability.test.ts` pins the RLS
 * predicates the data skill prints. Change any assertion here and the skill
 * section is what needs editing, not the assertion.
 */
describe('validateSearchableFields — objectstack-ui SKILL.md parity (#6675)', () => {
  /** The object the skill's examples and quoted error texts are written against. */
  const supportCase = {
    name: 'support_case',
    nameField: 'subject',
    searchableFields: ['subject', 'case_number', 'description'],
    fields: {
      subject: { type: 'text' },
      case_number: { type: 'autonumber' },
      description: { type: 'textarea' },
      status: { type: 'select' },
      account_id: { type: 'lookup', reference: 'crm_account' },
      account_name: { type: 'text' },
    },
  };

  /** A `defineView` container whose `triage` list narrows the object's set. */
  const viewStack = (searchableFields: unknown, objectOverrides: Record<string, unknown> = {}) => ({
    objects: [{ ...supportCase, ...objectOverrides }],
    views: [
      {
        name: 'support_case',
        objectName: 'support_case',
        list: {
          label: 'All Cases',
          type: 'grid',
          data: { provider: 'object', object: 'support_case' },
          columns: ['subject', 'status'],
        },
        listViews: {
          triage: {
            label: 'Triage',
            type: 'grid',
            data: { provider: 'object', object: 'support_case' },
            columns: ['case_number', 'subject', 'status'],
            ...(searchableFields === undefined ? {} : { searchableFields }),
          },
        },
      },
    ],
  });

  it('the skill\'s `os:check` example lints clean — a subset of the allowed set', () => {
    // SKILL.md: `listViews.triage.searchableFields: ['case_number', 'subject']`.
    expect(validateSearchableFields(viewStack(['case_number', 'subject']))).toEqual([]);
  });

  it('omitting the key lints clean (row 2 of the skill\'s boundary table)', () => {
    expect(validateSearchableFields(viewStack(undefined))).toEqual([]);
  });

  /**
   * The skill states an empty array is identical to omitting the key — the
   * claim an author most needs, because the spelling suggests the opposite.
   *
   * The lint half of it is deliberately NOT the assertion that carries this
   * test. `checkSearchableFieldList` returns early on a zero-length array, and
   * even without that early return the entry loop has nothing to iterate — so
   * "lints clean" is green because nothing was produced, not because the
   * verdict is right, and it cannot go red on a regression. It is asserted
   * below only to pin that no finding appears; the load-bearing assertion is
   * the next one.
   *
   * `resolveSearchFields` is where `[]` acquires meaning: it is the ONE
   * resolution the ingress gate (`assertSearchFieldsAreSearchable`) and the
   * engine (`expandSearchToFilter`) share, so an empty request resolving to
   * the full allowed set IS the runtime behaviour the skill describes. Narrow
   * the fall-through and this goes red.
   */
  it('`searchableFields: []` is ABSENT, not "search off" — it resolves to the FULL allowed set', () => {
    expect(validateSearchableFields(viewStack([]))).toEqual([]);

    const resolutionArgs = {
      fields: supportCase.fields,
      searchableFields: supportCase.searchableFields,
      displayField: supportCase.nameField,
    };
    // An empty narrowing scans every column the object allows …
    expect(resolveSearchFields({ ...resolutionArgs, requestedFields: [] }))
      .toEqual(['subject', 'case_number', 'description']);
    // … which is exactly what omitting the key does …
    expect(resolveSearchFields(resolutionArgs))
      .toEqual(['subject', 'case_number', 'description']);
    // … and strictly MORE than a one-entry narrowing, the inversion the skill
    // calls out: `[]` searches wider than `['subject']`.
    expect(resolveSearchFields({ ...resolutionArgs, requestedFields: ['subject'] }))
      .toEqual(['subject']);
  });

  it('quotes the dotted-path diagnostic exactly as the skill prints it', () => {
    const findings = validateSearchableFields(viewStack(['subject', 'account_id.name']));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toBe(
      'list-view searchableFields entry "account_id.name" is not a field on object '
      + '"support_case". The declaration is stale: searching it can never match, and the '
      + 'engine silently drops it — leaving a narrower search than declared, or the '
      + 'auto-default set once every entry is dropped.',
    );
  });

  it('quotes the outside-the-declared-set diagnostic exactly as the skill prints it', () => {
    const findings = validateSearchableFields(viewStack(['subject', 'status']));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toBe(
      'list-view searchableFields entry "status" is outside object "support_case"\'s '
      + 'declared searchableFields (subject, case_number, description) — the set \'search\' '
      + 'scans. Clients echo this declaration verbatim as the \'$searchFields\' override, '
      + 'and the runtime refuses an entry outside the allowed set: every toolbar search on '
      + 'this list returns 400 INVALID_FIELD (#4254).',
    );
  });

  /**
   * The correction the skill makes to a type-first reading: on an object that
   * DECLARES its set, the declaration is the boundary and the field's type is
   * not consulted — a lookup inside it is scanned, a text column outside it is
   * refused. Both directions, because either alone reads as a coincidence.
   */
  it('a lookup INSIDE the object\'s declared set is accepted; a text column OUTSIDE it is not', () => {
    const declaresLookup = { searchableFields: ['subject', 'account_id'] };

    expect(validateSearchableFields(viewStack(['account_id'], declaresLookup))).toEqual([]);

    const refused = validateSearchableFields(viewStack(['account_name'], declaresLookup));
    expect(refused).toHaveLength(1);
    expect(refused[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(refused[0].message).toContain('"account_name"');
  });

  /**
   * …and the mirror image: with NO declaration on the object, the auto-default
   * is the boundary, so type is exactly what decides. `select` is in the
   * text-like set the skill lists; `lookup` is not.
   */
  it('with no object declaration, the auto-default type list decides', () => {
    const noDeclaration = { searchableFields: undefined };

    expect(validateSearchableFields(viewStack(['subject', 'status'], noDeclaration))).toEqual([]);

    const refused = validateSearchableFields(viewStack(['account_id'], noDeclaration));
    expect(refused).toHaveLength(1);
    expect(refused[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(refused[0].message).toContain("of type 'lookup', which 'search' cannot scan");
  });
});

/**
 * [#6674] A virtual `formula` entry — the one check that runs on the object's
 * OWN set as well as on a view's narrowing.
 *
 * The card's shape: the entry names a real field, so the existence check passes
 * it; the runtime's declared branch admitted it verbatim; and the search then
 * matched nothing, because a formula value is computed on read and no driver
 * materializes a column for it (0 rows on driver-memory, 0 rows WITH NO ERROR on
 * driver-sql). Declared coverage, zero delivery — the fail-open #4254 closed on
 * the unknown-name axis, surviving on the known-but-virtual one.
 */
describe('[#6674] validateSearchableFields — a virtual formula entry', () => {
  const accountFields = {
    name: { type: 'text' },
    billing_email: { type: 'email' },
    payload: { type: 'json' },
    account_id: { type: 'lookup', reference: 'crm_account' },
    display_label: { type: 'formula', expression: "record.name + ' · x'" },
  };

  it("flags it on the OBJECT's own searchableFields — previously clean", () => {
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: accountFields,
          searchableFields: ['name', 'display_label'],
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('objects[0].searchableFields[1]');
    expect(findings[0].where).toBe('object "crm_account"');
    expect(findings[0].message).toContain("is a virtual 'formula' field");
    expect(findings[0].message).toContain('computed on read and never stored');
    // The fix is a STORED mirror — the same prescription #6673 put on the
    // neighbouring hints, and the only one that can work here.
    expect(findings[0].hint).toContain('stored text field');
    expect(findings[0].hint).toContain('400 INVALID_FIELD');
  });

  it('flags it on a list view narrowing too', () => {
    const findings = validateSearchableFields({
      objects: [
        {
          name: 'crm_account',
          fields: accountFields,
          listViews: { all: { type: 'grid', searchableFields: ['name', 'display_label'] } },
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNSEARCHABLE);
    expect(findings[0].path).toBe('objects[0].listViews.all.searchableFields[1]');
    expect(findings[0].message).toContain("is a virtual 'formula' field");
  });

  it('CONTROL — a json or lookup entry on the OBJECT\'s own set stays clean', () => {
    // The carve-out #4830 wrote down, deliberately preserved: the runtime's
    // declared branch executes those (a `$contains` over the stored JSON text /
    // the stored foreign key). Narrow and rarely useful, but a scan that CAN
    // match — flagging it would reject metadata the runtime accepts (ADR-0072
    // D1). If this control ever goes red, #6674 has quietly become "the declared
    // branch is type-filtered", which it is not.
    expect(
      validateSearchableFields({
        objects: [
          {
            name: 'crm_account',
            fields: accountFields,
            searchableFields: ['name', 'payload', 'account_id'],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('CONTROL — a stale entry on the object\'s own set keeps the #4254 message', () => {
    const findings = validateSearchableFields({
      objects: [
        { name: 'crm_account', fields: accountFields, searchableFields: ['name', 'gone'] },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SEARCHABLE_FIELD_UNKNOWN);
    expect(findings[0].message).toContain('is not a field on object');
  });

  it('an ALL-virtual declaration is reported, not silently swapped for the auto-default', () => {
    // The degenerate case: at runtime the declaration filters to empty and
    // resolution falls through to the auto-default, so the object silently
    // searches a set the author never wrote. The build error is what stops that
    // being invisible.
    const findings = validateSearchableFields({
      objects: [
        { name: 'crm_account', fields: accountFields, searchableFields: ['display_label'] },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].searchableFields[0]');
    expect(findings[0].message).toContain("is a virtual 'formula' field");
  });
});

/**
 * [#8404] The FIFTH blanket-`SYSTEM_FIELDS` read site. Existence and provenance
 * are different questions: on an ADR-0015 `external` object the platform
 * registers `owner_id` and provisions no storage behind it, so the entry
 * resolves (skip 3 keeps `searchable-field-unknown` silent, correctly) and
 * scans a column empty on every record.
 *
 * The external object DECLARES a field map on purpose — an external object with
 * none takes skip 2 and never reaches any of this, so a fixture without
 * `fields` would assert nothing.
 */
describe('[#8404] validateSearchableFields — a declared unprovisioned anchor', () => {
  const externalStack = (objectExtra: Record<string, unknown> = {}) => ({
    objects: [
      {
        name: 'ext_customer',
        external: { remoteName: 'customers' },
        fields: { name: { type: 'text' }, tier: { type: 'select' } },
        ...objectExtra,
      },
    ],
  });
  const only = (findings: ReturnType<typeof validateSearchableFields>) =>
    findings.filter((f) => f.rule === SEARCHABLE_FIELD_UNPROVISIONED);

  it('warns on the object\'s own canonical set, and the existence rule stays silent', () => {
    const findings = validateSearchableFields(
      externalStack({ searchableFields: ['name', 'owner_id'] }),
    );

    expect(findings.filter((f) => f.rule === SEARCHABLE_FIELD_UNKNOWN)).toHaveLength(0);
    const warned = only(findings);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].path).toBe('objects[0].searchableFields[1]');
    expect(warned[0].message).toContain('owner_id');
    expect(warned[0].message).toContain('external object (ADR-0015)');
    // The canonical consequence, not the narrowing one.
    expect(warned[0].message).toContain('narrower than it declares');
    expect(warned[0].hint).toContain('columnMap');
  });

  it('is silent on the local twin — platform storage is real (mutation: drop `external`)', () => {
    // The negative that proves the rule discriminates on PROVENANCE rather than
    // on the NAME: same declaration, same `owner_id`, non-external object.
    const findings = validateSearchableFields(
      externalStack({ external: undefined, searchableFields: ['name', 'owner_id'] }),
    );

    expect(findings).toEqual([]);
  });

  it('is silent when the author DECLARES the column (#7859 — a remote column they vouch for)', () => {
    const findings = validateSearchableFields(
      externalStack({
        fields: { name: { type: 'text' }, owner_id: { type: 'text' } },
        searchableFields: ['name', 'owner_id'],
      }),
    );

    expect(only(findings)).toHaveLength(0);
  });

  it('names the NARROWING consequence on a list view, and warns once per authored entry', () => {
    // Two authoring locations declare the same anchor — the object's own set
    // and the view that narrows it. Each is a separate edit the author must
    // make, so each warns exactly once; the emission site is the entry loop,
    // never `resolveAllowedSet` (which would repeat the object-level fact for
    // every view).
    const findings = validateSearchableFields(
      externalStack({
        searchableFields: ['name', 'owner_id'],
        listViews: { all: { type: 'grid', searchableFields: ['owner_id'] } },
      }),
    );

    const warned = only(findings);
    expect(warned.map((f) => f.path)).toEqual([
      'objects[0].searchableFields[1]',
      'objects[0].listViews.all.searchableFields[0]',
    ]);
    expect(warned[1].message).toContain('$searchFields');
    expect(warned[1].message).toContain('empty on every');
    // The stub keeps the anchor inside the resolved allow-list, so the #4830
    // admissibility rule stays silent and this is the ONLY finding on it.
    expect(findings.filter((f) => f.rule === SEARCHABLE_FIELD_UNSEARCHABLE)).toHaveLength(0);
  });

  it('asks the provenance question only when the caller builds the index', () => {
    // The optional trailing parameter's contract: its absence is the pre-#8404
    // behaviour, preserved for out-of-repo callers (cloud graph-lint, the AI
    // authoring path). Same stack, same core, index withheld -> silence.
    const stack = externalStack({ searchableFields: ['name', 'owner_id'] });
    const targets = indexObjectSearchTargets(stack);

    const withoutIndex = checkSearchableFieldList(
      ['name', 'owner_id'],
      'ext_customer',
      targets,
      'where',
      'p',
      'searchableFields',
      'canonical',
    );
    expect(withoutIndex).toEqual([]);

    const withIndex = checkSearchableFieldList(
      ['name', 'owner_id'],
      'ext_customer',
      targets,
      'where',
      'p',
      'searchableFields',
      'canonical',
      indexUnprovisionedAnchors(stack),
    );
    expect(withIndex).toHaveLength(1);
    expect(withIndex[0].rule).toBe(SEARCHABLE_FIELD_UNPROVISIONED);
    expect(withIndex[0].path).toBe('p[1]');
  });
});
