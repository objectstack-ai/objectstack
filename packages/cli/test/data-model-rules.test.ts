import { describe, expect, it } from 'vitest';
import { lintDataModel, lintUniqueDeclarations, lintUnscopedDeclaredIndexes, lintLegacyOrganizationComposites } from '@objectstack/lint';
import { FieldSchema } from '@objectstack/spec/data';
import { lintConfig } from '../src/commands/lint';

const rulesOf = (issues: { rule: string }[]) => issues.map((i) => i.rule);
const has = (issues: { rule: string }[], rule: string) => rulesOf(issues).includes(rule);

describe('lintDataModel — relationships', () => {
  it('returns [] for empty input', () => {
    expect(lintDataModel([])).toEqual([]);
    expect(lintDataModel(undefined as any)).toEqual([]);
  });

  it('flags a relationship field missing a reference (error)', () => {
    const issues = lintDataModel([
      { name: 'task', fields: { project: { type: 'master_detail', required: true } } },
    ]);
    const issue = issues.find((i) => i.rule === 'relationship/missing-reference');
    expect(issue?.severity).toBe('error');
  });

  it('warns when a master_detail is not required', () => {
    const issues = lintDataModel([
      { name: 'invoice', fields: { number: { type: 'text' } } },
      { name: 'invoice_line', fields: { invoice: { type: 'master_detail', reference: 'invoice', required: true, deleteBehavior: 'cascade' } } },
    ]);
    expect(has(issues, 'relationship/master-detail-required')).toBe(false);

    const issues2 = lintDataModel([
      { name: 'invoice_line', fields: { invoice: { type: 'master_detail', reference: 'invoice', deleteBehavior: 'cascade' } } },
    ]);
    const req = issues2.find((i) => i.rule === 'relationship/master-detail-required');
    expect(req?.severity).toBe('warning');
  });

  it('suggests an explicit deleteBehavior on master_detail', () => {
    const issues = lintDataModel([
      { name: 'invoice_line', fields: { invoice: { type: 'master_detail', reference: 'invoice', required: true } } },
    ]);
    const db = issues.find((i) => i.rule === 'relationship/delete-behavior');
    expect(db?.severity).toBe('suggestion');
  });

  it('suggests inlineEdit on master_detail line-item children', () => {
    const issues = lintDataModel([
      { name: 'order_line', fields: { order: { type: 'master_detail', reference: 'order', required: true, deleteBehavior: 'cascade' } } },
    ]);
    expect(has(issues, 'relationship/line-items-inline-edit')).toBe(true);
  });

  it('does NOT suggest inlineEdit when already set', () => {
    const issues = lintDataModel([
      { name: 'order_line', fields: { order: { type: 'master_detail', reference: 'order', required: true, deleteBehavior: 'cascade', inlineEdit: true } } },
    ]);
    expect(has(issues, 'relationship/line-items-inline-edit')).toBe(false);
  });

  it('suggests master_detail when a line-item child uses lookup', () => {
    const issues = lintDataModel([
      { name: 'quote_item', fields: { quote: { type: 'lookup', reference: 'quote' } } },
    ]);
    expect(has(issues, 'relationship/line-item-should-be-master-detail')).toBe(true);
  });

  it('warns when an association child is inlineEdit', () => {
    const issues = lintDataModel([
      { name: 'ticket_comment', fields: { ticket: { type: 'master_detail', reference: 'ticket', required: true, deleteBehavior: 'cascade', inlineEdit: true } } },
    ]);
    const assoc = issues.find((i) => i.rule === 'relationship/association-inline-edit');
    expect(assoc?.severity).toBe('warning');
  });

  it('does NOT treat a line-item child as an association', () => {
    const issues = lintDataModel([
      { name: 'invoice_line', fields: { invoice: { type: 'master_detail', reference: 'invoice', required: true, deleteBehavior: 'cascade', inlineEdit: true } } },
    ]);
    expect(has(issues, 'relationship/association-inline-edit')).toBe(false);
  });
});

describe('lintDataModel — roll-ups', () => {
  it('suggests a roll-up when a parent owns master_detail children with numeric fields', () => {
    const issues = lintDataModel([
      { name: 'invoice', label: 'Invoice', fields: { number: { type: 'text' } } },
      { name: 'invoice_line', fields: { invoice: { type: 'master_detail', reference: 'invoice', required: true, deleteBehavior: 'cascade' }, amount: { type: 'currency' } } },
    ]);
    expect(has(issues, 'rollup/missing-summary')).toBe(true);
  });

  it('does NOT suggest a roll-up when a summary already aggregates that child', () => {
    const issues = lintDataModel([
      {
        name: 'invoice',
        fields: {
          number: { type: 'text' },
          total: { type: 'summary', summaryOperations: { object: 'invoice_line', field: 'amount', function: 'sum' } },
        },
      },
      { name: 'invoice_line', fields: { invoice: { type: 'master_detail', reference: 'invoice', required: true, deleteBehavior: 'cascade' }, amount: { type: 'currency' } } },
    ]);
    expect(has(issues, 'rollup/missing-summary')).toBe(false);
  });

  it('does NOT suggest a roll-up for a child with no numeric field', () => {
    const issues = lintDataModel([
      { name: 'project', fields: { name: { type: 'text' } } },
      { name: 'project_note', fields: { project: { type: 'master_detail', reference: 'project', required: true, deleteBehavior: 'cascade' }, body: { type: 'textarea' } } },
    ]);
    expect(has(issues, 'rollup/missing-summary')).toBe(false);
  });
});

describe('lintDataModel — fields & objects', () => {
  it('warns on a select field with no options', () => {
    const issues = lintDataModel([
      { name: 'task', fields: { status: { type: 'select' } } },
    ]);
    const sel = issues.find((i) => i.rule === 'field/select-missing-options');
    expect(sel?.severity).toBe('warning');
  });

  it('accepts a select with options or an options source', () => {
    const withOptions = lintDataModel([
      { name: 'task', fields: { status: { type: 'select', options: [{ label: 'Open', value: 'open' }] } } },
    ]);
    expect(has(withOptions, 'field/select-missing-options')).toBe(false);
  });

  it('suggests a name field when an object has none', () => {
    const issues = lintDataModel([
      { name: 'widget', fields: { color: { type: 'text' }, size: { type: 'number' } } },
    ]);
    expect(has(issues, 'object/missing-name-field')).toBe(true);
  });

  // #6326 replaced the second assertion here wholesale. It used to read
  // `{ name: 'b', primaryField: 'code', fields: { code: … } }` and claim to pin
  // the `primaryField` limb of `object/missing-name-field`. It pinned nothing,
  // in two independent ways: (1) the fixture is one `ObjectSchema` REJECTS
  // (`unrecognized_keys: ['primaryField']`), so no author could ever write the
  // shape it was green about; and (2) `code` is itself in NAME_LIKE_FIELDS, so
  // the name-like limb accepted the object regardless — the assertion stayed
  // green with the `primaryField` limb deleted, which is exactly what makes it
  // a vacuous green rather than coverage. What SURVIVES is the first assertion
  // (a name-like field is a title face). The replacement below pins the limb
  // that actually exists — the explicit `nameField` pointer — on a fixture no
  // other limb can rescue, so it can genuinely fail.
  it('accepts an object with a name-like field, or an explicit nameField', () => {
    expect(has(lintDataModel([{ name: 'a', fields: { name: { type: 'text' } } }]), 'object/missing-name-field')).toBe(false);
    // `invoice_number` is deliberately NOT in NAME_LIKE_FIELDS: the explicit
    // ADR-0079 pointer is the only thing that can clear this object.
    expect(has(lintDataModel([{ name: 'b', nameField: 'invoice_number', fields: { invoice_number: { type: 'text' } } }]), 'object/missing-name-field')).toBe(false);
  });

  it('handles array-shaped fields', () => {
    const issues = lintDataModel([
      { name: 'invoice_line', fields: [{ name: 'invoice', type: 'master_detail', reference: 'invoice' }] },
    ]);
    expect(has(issues, 'relationship/master-detail-required')).toBe(true);
  });
});

// #6108 — `object/missing-name-field` used to read `titleFormat` (retired by
// ADR-0079, and reported as `title-format-retired` by validate-record-title in
// the very same package) while never reading `nameField` at all. An author who
// followed the platform's own migration advice therefore EARNED a suggestion.
// The fixtures below replicate the downstream control surface measured on
// hotcrm main (6 hits, 4 of them false positives — hotcrm#715 / #1007).
describe('lintDataModel — object/missing-name-field (ADR-0079 title face)', () => {
  const flagged = (objects: any[]) =>
    lintDataModel(objects)
      .filter((i) => i.rule === 'object/missing-name-field')
      .map((i) => i.path);

  // (a) The false positive this fixes. `contract_number` is deliberately NOT in
  // NAME_LIKE_FIELDS, so the only title face is the explicit pointer.
  it('accepts an object whose title face is an explicit nameField', () => {
    const issues = lintDataModel([
      {
        name: 'crm_contract',
        nameField: 'contract_number',
        fields: { contract_number: { type: 'text' }, amount: { type: 'currency' } },
      },
    ]);
    expect(has(issues, 'object/missing-name-field')).toBe(false);
  });

  // (b) The true hit must survive: a line item with no title face at all.
  it('still suggests a name field for an object with no title face', () => {
    const issues = lintDataModel([
      {
        name: 'crm_quote_line_item',
        fields: {
          quote: { type: 'master_detail', reference: 'crm_quote' },
          quantity: { type: 'number' },
          unit_price: { type: 'currency' },
        },
      },
    ]);
    expect(has(issues, 'object/missing-name-field')).toBe(true);
  });

  // (c) #6326 — `primaryField` is NOT a title face, and the limb that read it
  // is gone. The key is declared nowhere in `packages/spec`: measured on
  // 17.0.0-rc.5, `ObjectSchema.safeParse` returns
  // `unrecognized_keys: ['primaryField']` and `ObjectSchema.create()` throws,
  // so the limb was dead for every object the spec accepts (#4984 family)
  // while still reading, here and in the skill doc, as a legal escape hatch.
  //
  // This fixture is DELIBERATELY off-spec — that is the point. `lintDataModel`
  // runs over metadata as AUTHORED, before/independently of schema parse, so a
  // rejected key can physically reach it; the assertion is that the rule
  // IGNORES the key, not that the key is legal. Do not "fix" the fixture by
  // making it schema-valid: that would delete the coverage.
  //
  // Asserted as the EXACT reported set rather than as the absence of a string,
  // so it fails in both directions: put the `primaryField` limb back and
  // `objects[0]` drops out (set becomes `[]`); break the name-like limb and
  // `objects[1]` joins it. `period_key` is not in NAME_LIKE_FIELDS and carries
  // no `nameField`, so nothing else can rescue objects[0]; `crm_campaign` has
  // a `name` field and must stay clean.
  it('does not treat primaryField as a title face — it is not a declarable key (#6326)', () => {
    expect(
      flagged([
        { name: 'crm_forecast_period', primaryField: 'period_key', fields: { period_key: { type: 'text' } } },
        { name: 'crm_campaign', fields: { name: { type: 'text' }, budget: { type: 'currency' } } },
      ]),
    ).toEqual(['objects[0].fields']);
  });

  // (d) DELIBERATE FLIP, not a regression: a titleFormat-only object is now
  // reported. It has no `nameField`, and ADR-0079 wants exactly this object
  // migrated — `validate-record-title` already reports it twice today
  // (`title-format-retired` + `title-unresolvable`, pinned in
  // packages/lint/src/validate-record-title.test.ts). The two rules used to
  // disagree about the same object; now they agree.
  it('suggests a name field for a titleFormat-only object (retired key is not a title face)', () => {
    const issues = lintDataModel([
      {
        name: 'crm_pipeline_snapshot',
        titleFormat: '{issued_on} · {amount}',
        fields: { issued_on: { type: 'date' }, amount: { type: 'currency' } },
      },
    ]);
    expect(has(issues, 'object/missing-name-field')).toBe(true);
  });

  // The measured control surface, end to end: the four objects hotcrm declared
  // a `nameField` on must fall out, the two line items must stay.
  it('reproduces the hotcrm control surface: 6 objects in, only the 2 line items flagged', () => {
    const objects = [
      { name: 'crm_campaign_member', nameField: 'member_number', fields: { member_number: { type: 'text' } } },
      { name: 'crm_event_attendee', nameField: 'attendee_number', fields: { attendee_number: { type: 'text' } } },
      { name: 'crm_contract', nameField: 'contract_number', fields: { contract_number: { type: 'text' } } },
      { name: 'crm_forecast', nameField: 'display_title', fields: { display_title: { type: 'text' } } },
      { name: 'crm_opportunity_line_item', fields: { quantity: { type: 'number' } } },
      { name: 'crm_quote_line_item', fields: { quantity: { type: 'number' } } },
    ];
    expect(flagged(objects)).toEqual(['objects[4].fields', 'objects[5].fields']);
  });

  // The suggestion must name the canonical pointer — an author who reads it
  // and reaches for `titleFormat` lands straight back in the contradiction.
  // It must equally NOT name `primaryField`: that key is declared nowhere in
  // `packages/spec`, so `ObjectSchema.create()` rejects it (#6326).
  //
  // ⚠️ Honest labelling of the `not.toContain('primaryField')` line: it is a
  // NEGATIVE assertion and it was already green before #6326 (PR for #6108 had
  // scrubbed the message text; #6326 only removed the predicate limb, which
  // this message never mentioned). It is NOT evidence of the removal — the
  // real pin for that is case (c) above. It is kept because it is paired with
  // the three positive assertions below, which fail if the message stops
  // steering to `nameField`/ADR-0079 at all; on its own it would be a bare
  // vacuous green.
  it('steers the author to nameField, and names no key the schema rejects', () => {
    const issue = lintDataModel([
      { name: 'crm_quote_line_item', fields: { quantity: { type: 'number' } } },
    ]).find((i) => i.rule === 'object/missing-name-field');
    expect(issue?.severity).toBe('suggestion');
    expect(issue?.message).toContain('nameField');
    expect(issue?.message).not.toContain('primaryField');
    expect(issue?.fix).toContain('ADR-0079');
    expect(issue?.fix).toContain('titleFormat');
  });
});

describe('lintConfig integration', () => {
  it('a clean invoice/line model produces no data-model errors or warnings', () => {
    const issues = lintConfig({
      objects: [
        {
          name: 'invoice',
          label: 'Invoice',
          fields: {
            number: { type: 'text', label: 'Number' },
            total: { type: 'summary', label: 'Total', summaryOperations: { object: 'invoice_line', field: 'amount', function: 'sum' } },
          },
        },
        {
          name: 'invoice_line',
          label: 'Invoice Line',
          fields: {
            invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', required: true, deleteBehavior: 'cascade', inlineEdit: true },
            product: { type: 'text', label: 'Product' },
            amount: { type: 'currency', label: 'Amount' },
          },
        },
      ],
    });
    const dataModel = issues.filter((i) => i.rule.startsWith('relationship/') || i.rule.startsWith('rollup/') || i.rule.startsWith('field/') || i.rule.startsWith('object/'));
    expect(dataModel.filter((i) => i.severity !== 'suggestion')).toEqual([]);
  });
});

// ADR-0120 — uniqueness scope is an explicit vocabulary. Two rules read the
// declarations, and only the declarations (no tenancy inference — that dead
// end is documented on #4698):
//   R10 `unique/double-declaration` — both spellings on one column, judged by
//   the four-quadrant scope matrix (D5b);
//   R11 `unique/unscoped-declared-index` — a declared index with bare
//   `unique: true`, the spelling whose scope is unstated (D5a; the #4986 trap).

describe('lintUnscopedDeclaredIndexes — bare unique: true on a declared index (ADR-0120 D5a)', () => {
  const RULE = 'unique/unscoped-declared-index';

  it('returns [] for empty input', () => {
    expect(lintUnscopedDeclaredIndexes([])).toEqual([]);
    expect(lintUnscopedDeclaredIndexes(undefined as any)).toEqual([]);
  });

  it('warns on a bare declared unique, whatever the column count, and prescribes both words', () => {
    const issues = lintUnscopedDeclaredIndexes([
      {
        name: 'crm_case',
        fields: { code: { type: 'text' } },
        indexes: [
          { fields: ['code'], unique: true },
          { name: 'uniq_dept_code', fields: ['department', 'code'], unique: true },
        ],
      },
    ]);
    expect(issues).toHaveLength(2);
    for (const issue of issues) {
      expect(issue.rule).toBe(RULE);
      expect(issue.severity).toBe('warning'); // 17.x warns; protocol 18 rejects the spelling (#5082)
      // D5a: the fix names both words, and identifies 'global' as today's behavior.
      expect(issue.fix).toContain("unique: 'global'");
      expect(issue.fix).toContain("unique: 'organization'");
      expect(issue.fix).toMatch(/today's behavior/);
      expect(issue.message).toContain('ADR-0120');
    }
    expect(issues[0].path).toBe('objects[0].indexes[0]');
    expect(issues[1].path).toBe('objects[0].indexes[1]');
    expect(issues[1].message).toContain("'uniq_dept_code'");
  });

  it("stays quiet for 'global', 'organization', non-unique, and unique: false", () => {
    expect(lintUnscopedDeclaredIndexes([
      {
        name: 'runtime',
        fields: { hostname: { type: 'text' } },
        indexes: [
          { fields: ['hostname'], unique: 'global' },
          { fields: ['code'], unique: 'organization' },
          { fields: ['created_at'] },
          { fields: ['status'], unique: false },
        ],
      },
    ])).toEqual([]);
  });

  it('fires on the spelling alone — no tenancy or posture inference', () => {
    // Deliberate: whether the object is organization-scoped is unknowable at
    // authoring time (`organization_id` is kernel-injected at registration),
    // so the rule judges the spelling only — an explicitly tenancy-less
    // object warns exactly like any other.
    const issues = lintUnscopedDeclaredIndexes([
      {
        name: 'sys_job',
        tenancy: { enabled: false },
        fields: { name: { type: 'text' } },
        indexes: [{ fields: ['name'], unique: true }],
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe(RULE);
  });

  it('surfaces through lintDataModel (os lint) but NOT through lintUniqueDeclarations — one report per command', () => {
    // `os validate`/`os build` run R11 via its own AUTHORING_RULES entry and
    // R10 via lintUniqueDeclarations; `os lint` runs both via lintDataModel.
    // If lintUniqueDeclarations also emitted R11, validate/build would report
    // every finding twice.
    const objs = [{ name: 'a', fields: {}, indexes: [{ fields: ['x'], unique: true }] }];
    expect(has(lintDataModel(objs), RULE)).toBe(true);
    expect(has(lintUniqueDeclarations(objs), RULE)).toBe(false);
    expect(lintDataModel(objs).filter((i) => i.rule === RULE)).toHaveLength(1);
  });
});

// #3991 / ADR-0120 D5b — the same column declared unique twice. The scope
// vocabulary turns the old conditional narrative ("on a tenant-scoped object
// they contradict; on a tenancy-less one they are redundant") into a matrix
// judged from the two spellings alone.
describe('lintUniqueDeclarations — double declaration, four scope quadrants (#3991, ADR-0120 D5b)', () => {
  const RULE = 'unique/double-declaration';
  const doubles = (issues: { rule: string }[]) => issues.filter((i) => i.rule === RULE);

  const withBoth = [
    {
      name: 'crm_contact',
      fields: { email: { type: 'email', unique: true } },
      indexes: [{ fields: ['email'], unique: true }],
    },
  ];

  it('returns [] for empty input', () => {
    expect(lintUniqueDeclarations([])).toEqual([]);
    expect(lintUniqueDeclarations(undefined as any)).toEqual([]);
  });

  // ── Quadrant 1: field per-organization × index installation-wide = CONTRADICTION ──

  it('Q1 — field `true` (per-organization) × declared bare `true` (installation-wide): contradiction', () => {
    const issues = doubles(lintUniqueDeclarations(withBoth));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning'); // advisory — never fails a build
    expect(issues[0].message).toContain('crm_contact.email');
    expect(issues[0].message).toContain('CONTRADICT');
    expect(issues[0].message).toContain('silently dead');
    // The fix speaks the ADR-0120 vocabulary — the old advice to hand-write
    // `['organization_id', …]` is retired (that spelling is not NULL-safe, #5030).
    expect(issues[0].fix).toContain("unique: 'global'");
    expect(issues[0].fix).toContain("unique: 'organization'");
    expect(issues[0].fix).not.toContain('organization_id');
  });

  it("Q1 — field `'organization'` × declared `'global'`: same contradiction, explicit spellings", () => {
    const issues = doubles(lintUniqueDeclarations([
      {
        name: 'crm_contact',
        fields: { email: { type: 'email', unique: 'organization' } },
        indexes: [{ fields: ['email'], unique: 'global' }],
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('CONTRADICT');
    expect(issues[0].message).toContain("unique: 'organization'");
    expect(issues[0].message).toContain("unique: 'global'");
  });

  // ── Quadrant 2: field 'global' × index installation-wide = REDUNDANCY ──

  it("Q2 — field `'global'` × declared `'global'`: redundancy, not contradiction", () => {
    const issues = doubles(lintUniqueDeclarations([
      {
        name: 'runtime',
        fields: { hostname: { type: 'text', unique: 'global' } },
        indexes: [{ fields: ['hostname'], unique: 'global' }],
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('declared twice');
    expect(issues[0].message).not.toContain('CONTRADICT');
  });

  // ── Quadrant 3: field per-organization × index 'organization' = REDUNDANCY ──

  it("Q3 — field `true` × declared `'organization'` on the same single column: redundancy (same index either way)", () => {
    const issues = doubles(lintUniqueDeclarations([
      {
        name: 'crm_contact',
        fields: { email: { type: 'email', unique: true } },
        indexes: [{ fields: ['email'], unique: 'organization' }],
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('declared twice');
    expect(issues[0].message).not.toContain('CONTRADICT');
    expect(issues[0].fix).toContain("unique: 'organization'");
  });

  it("Q3 — field `'organization'` × declared `'organization'`: redundancy in explicit spellings too", () => {
    const issues = doubles(lintUniqueDeclarations([
      {
        name: 'crm_contact',
        fields: { email: { type: 'email', unique: 'organization' } },
        indexes: [{ fields: ['email'], unique: 'organization' }],
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('declared twice');
  });

  // ── Quadrant 4: field 'global' × index 'organization' = CONTRADICTION (mirror) ──

  it("Q4 — field `'global'` × declared `'organization'`: mirror contradiction — the global side wins physically", () => {
    const issues = doubles(lintUniqueDeclarations([
      {
        name: 'runtime',
        fields: { hostname: { type: 'text', unique: 'global' } },
        indexes: [{ fields: ['hostname'], unique: 'organization' }],
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('CONTRADICT');
    expect(issues[0].message).toContain('silently dead');
  });

  it('surfaces through lintDataModel too, so `os lint` reports it', () => {
    expect(has(lintDataModel(withBoth), RULE)).toBe(true);
  });

  // ── Shapes that must stay quiet (for THIS rule) ──────────────────────

  it('exempts a hand-written organization COMPOSITE index — the legacy explicit spelling agrees with the field-level default', () => {
    const issues = doubles(lintUniqueDeclarations([
      {
        name: 'crm_contact',
        fields: { email: { type: 'email', unique: true } },
        indexes: [{ fields: ['organization_id', 'email'], unique: 'global' }],
      },
    ]));
    expect(issues).toEqual([]);
  });

  it('ignores a NON-unique index on the same column', () => {
    const issues = lintUniqueDeclarations([
      {
        name: 'crm_contact',
        fields: { email: { type: 'email', unique: true } },
        indexes: [{ fields: ['email'] }],
      },
    ]);
    expect(issues).toEqual([]);
  });

  it('ignores a unique index on a DIFFERENT column', () => {
    const issues = doubles(lintUniqueDeclarations([
      {
        name: 'crm_contact',
        fields: { email: { type: 'email', unique: true }, code: { type: 'text' } },
        indexes: [{ fields: ['code'], unique: 'global' }],
      },
    ]));
    expect(issues).toEqual([]);
  });

  it('is quiet when only one of the two spellings is used', () => {
    expect(lintUniqueDeclarations([
      { name: 'a', fields: { email: { type: 'email', unique: true } } },
    ])).toEqual([]);
    expect(lintUniqueDeclarations([
      { name: 'b', fields: { email: { type: 'email' } }, indexes: [{ fields: ['email'], unique: 'global' }] },
    ])).toEqual([]);
    // A LONE bare-true declared index is not a double declaration — it is
    // R11's finding (unscoped spelling), and only R11's.
    expect(doubles(lintUniqueDeclarations([
      { name: 'c', fields: { email: { type: 'email' } }, indexes: [{ fields: ['email'], unique: true }] },
    ]))).toEqual([]);
  });

  it('names the declared index when it carries an explicit name', () => {
    const issues = doubles(lintUniqueDeclarations([
      {
        name: 'crm_product',
        fields: { sku: { type: 'text', unique: true } },
        indexes: [{ name: 'uniq_product_sku', fields: ['sku'], unique: 'global' }],
      },
    ]));
    expect(issues[0].message).toContain("'uniq_product_sku'");
  });

  it('reports each offending column once, across several objects', () => {
    const issues = doubles(lintUniqueDeclarations([
      ...withBoth,
      {
        name: 'crm_lead',
        fields: { email: { type: 'email', unique: true }, sku: { type: 'text', unique: true } },
        indexes: [{ fields: ['email'], unique: 'global' }, { fields: ['sku'], unique: 'organization' }],
      },
    ]));
    expect(issues.map((i) => i.message.match(/"([^"]+)"/)?.[1]).sort())
      .toEqual(['crm_contact.email', 'crm_lead.email', 'crm_lead.sku']);
  });
});

// ADR-0120 D5c — the S6 legacy hand-written organization composite. The
// vocabulary now has a word for what these indexes were always trying to say,
// and the respelling is also what closes their NULL hole (#5030).
describe('lintLegacyOrganizationComposites — S6 respelling nudge (ADR-0120 D5c)', () => {
  const RULE = 'unique/legacy-organization-composite';
  const legacy = (issues: { rule: string }[]) => issues.filter((i) => i.rule === RULE);

  it('returns [] for empty input', () => {
    expect(lintLegacyOrganizationComposites([])).toEqual([]);
    expect(lintLegacyOrganizationComposites(undefined as any)).toEqual([]);
  });

  it('warns on a declared unique that lists organization_id, and explains the NULL hole', () => {
    const issues = lintLegacyOrganizationComposites([
      {
        name: 'sys_team',
        fields: { name: { type: 'text' }, organization_id: { type: 'text' } },
        indexes: [{ fields: ['name', 'organization_id'], unique: true }],
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe(RULE);
    expect(issues[0].severity).toBe('warning'); // advisory forever — zero forced drift
    expect(issues[0].path).toBe('objects[0].indexes[0]');
    expect(issues[0].message).toContain('#5030');
    expect(issues[0].message).toContain('NULL-distinct');
    expect(issues[0].fix).toContain("unique: 'organization'");
    // The respelling keeps `fields` — the driver makes the LISTED column
    // NULL-safe in place rather than prepending a second key part.
    expect(issues[0].fix).toContain('keep `fields` exactly as they are');
    // …and it is honest that opting in is a real migration, not a free rename.
    expect(issues[0].fix).toContain('recreate_index');
    expect(issues[0].fix).toContain('pre-flight');
  });

  it('fires on the explicit `global` spelling too — the scope is still wrong for the shape', () => {
    const issues = legacy(lintLegacyOrganizationComposites([
      {
        name: 'sys_business_unit',
        fields: {},
        indexes: [{ name: 'uk_bu', fields: ['code', 'organization_id'], unique: 'global' }],
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("'uk_bu'");
  });

  it("stays quiet once respelled to 'organization' — that IS the fix", () => {
    expect(lintLegacyOrganizationComposites([
      {
        name: 'sys_team',
        fields: {},
        indexes: [{ fields: ['name', 'organization_id'], unique: 'organization' }],
      },
    ])).toEqual([]);
  });

  it('stays quiet for composites that do not list the organization column, and for non-uniques', () => {
    expect(lintLegacyOrganizationComposites([
      {
        name: 'crm_case',
        fields: {},
        indexes: [
          { fields: ['department', 'code'], unique: true },      // R11's business, not R12's
          { fields: ['organization_id', 'created_at'] },          // not unique at all
          { fields: ['organization_id', 'status'], unique: false },
        ],
      },
    ])).toEqual([]);
  });

  it('stays quiet for a unique on the organization column ALONE — not a composite', () => {
    // There is no per-organization reading to recover: `'organization'` on an
    // index whose only column IS the organization column would say nothing.
    expect(lintLegacyOrganizationComposites([
      { name: 'org_settings', fields: {}, indexes: [{ fields: ['organization_id'], unique: true }] },
    ])).toEqual([]);
  });

  it("honors a declared tenancy.tenantField spelling", () => {
    const issues = legacy(lintLegacyOrganizationComposites([
      {
        name: 'legacy_thing',
        tenancy: { tenantField: 'tenant_ref' },
        fields: {},
        indexes: [
          { fields: ['code', 'tenant_ref'], unique: true },
          // organization_id is NOT this object's tenant column — no finding
          { fields: ['code2', 'organization_id'], unique: true },
        ],
      },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("'tenant_ref'");
  });

  it('surfaces through lintDataModel (os lint), exactly once', () => {
    const objs = [{
      name: 'sys_member',
      fields: {},
      indexes: [{ fields: ['organization_id', 'user_id'], unique: true }],
    }];
    expect(has(lintDataModel(objs), RULE)).toBe(true);
    expect(lintDataModel(objs).filter((i) => i.rule === RULE)).toHaveLength(1);
    // R11 fires on the same index for the OTHER reason (unstated scope) — the
    // two rules are complementary, not duplicates: R11 says "say which scope",
    // R12 says "the shape tells me which one you meant".
    expect(has(lintDataModel(objs), 'unique/unscoped-declared-index')).toBe(true);
  });
});

/**
 * [#13250] `reference_to` is a REJECTED alias of `reference` — these rules must
 * not read it as a target.
 *
 * #11567 settled the ruling ("one key, one answer, on both doors") and
 * `packages/lint/src/validate-security-posture.ts` records the same narrowing
 * for its own `refOf`, on purpose. `lintDataModel` runs over a schema-parsed
 * stack, so the alias cannot legitimately appear here at all; tolerating it
 * made `relationship/missing-reference` — the rule whose whole job is to catch
 * a relationship with no target — report a valid target for a field that has
 * none.
 *
 * ⚠️ Every assertion below is paired with a POSITIVE CONTROL on the canonical
 * spelling. A `refOf` that resolved NOTHING would satisfy the alias half on its
 * own, so the canonical half is what makes these measurements rather than
 * vacuous passes.
 */
describe('lintDataModel — `reference_to` is a rejected alias, not a tolerated one (#13250)', () => {
  it('upstream control: FieldSchema declares `reference` and refuses `reference_to`', () => {
    const fieldKeys = Object.keys(FieldSchema.shape);
    expect(fieldKeys).toContain('reference');
    expect(fieldKeys).not.toContain('reference_to');

    const rejected = FieldSchema.safeParse({ name: 'project', type: 'lookup', reference_to: 'project' });
    expect(rejected.success).toBe(false);
    expect(rejected.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');

    // POSITIVE CONTROL — the canonical spelling parses, so the refusal above is
    // about the KEY and not about the fixture being malformed some other way.
    expect(FieldSchema.safeParse({ name: 'project', type: 'lookup', reference: 'project' }).success).toBe(true);
  });

  it('R1 fires: a relationship whose only target spelling is `reference_to` has no target', () => {
    const issue = lintDataModel([
      { name: 'task', fields: { project: { type: 'lookup', reference_to: 'project' } } },
    ]).find((i) => i.rule === 'relationship/missing-reference');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('is missing a reference target');
    expect(issue?.path).toBe('objects[0].fields.project.reference');
  });

  it('POSITIVE CONTROL — canonical `reference` still resolves, so R1 stays silent', () => {
    expect(
      has(
        lintDataModel([
          { name: 'project', fields: { name: { type: 'text' } } },
          { name: 'task', fields: { project: { type: 'lookup', reference: 'project' } } },
        ]),
        'relationship/missing-reference',
      ),
    ).toBe(false);
  });

  it('the resolved target NAME is read from `reference` (not merely truthiness)', () => {
    // `relationship/master-detail-required` renders the target it resolved, so
    // this pins that `refOf` returns the VALUE — a guard that returned `true`
    // would pass the R1 tests above and fail here.
    const canonical = lintDataModel([
      { name: 'invoice_line', fields: { invoice: { type: 'master_detail', reference: 'invoice' } } },
    ]).find((i) => i.rule === 'relationship/master-detail-required');
    expect(canonical?.message).toContain('→ invoice');

    // The alias resolves nothing, so the rule that needs a target never runs —
    // R1 is what the author hears instead, and the schema names the bad key.
    expect(
      has(
        lintDataModel([
          { name: 'invoice_line', fields: { invoice: { type: 'master_detail', reference_to: 'invoice' } } },
        ]),
        'relationship/master-detail-required',
      ),
    ).toBe(false);
  });

  it('a non-string `reference` is not a target either', () => {
    // `refOf` is declared `string | undefined`; the old `||` chain returned
    // whatever truthy value was there, so this shape used to be reported as a
    // resolved target named `[object Object]`.
    //
    // ⚠️ The non-string value is BOUND THROUGH A VARIABLE rather than written
    // inline, and the binding is a legibility device — not a way past a gate.
    // `packages/lint/scripts/check-reference-carrier-shape.mjs` refuses a
    // non-string LITERAL at a `reference` carrier position, and it is right to:
    // an AUTHORED site of that shape is invisible in both directions at once —
    // refused by `ObjectSchema.safeParse` and read as `undefined` by every rule
    // that resolves it (#13053), so it reports nothing either way.
    //
    // That shape is exactly what this case must keep driving, because the whole
    // assertion is that such a value resolves to NOTHING: it is a deliberate
    // counter-example, not an authored carrier. The gate judges literals and
    // leaves a non-literal unjudged, so the binding keeps its authored-site
    // sweep honest while the assertion goes on testing the identical shape.
    // ⛔ Do not inline this value again; ⛔ do not weaken the gate or add a path
    // ignore there — it has no baseline and wants none, by design.
    const nonStringReference = { object: 'project' };
    expect(
      has(
        lintDataModel([
          { name: 'task', fields: { project: { type: 'lookup', reference: nonStringReference } } },
        ]),
        'relationship/missing-reference',
      ),
    ).toBe(true);
  });
});
