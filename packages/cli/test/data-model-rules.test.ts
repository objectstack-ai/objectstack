import { describe, expect, it } from 'vitest';
import { lintDataModel, lintUniqueDeclarations, lintUnscopedDeclaredIndexes } from '@objectstack/lint';
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

  it('accepts an object with a name field or primaryField', () => {
    expect(has(lintDataModel([{ name: 'a', fields: { name: { type: 'text' } } }]), 'object/missing-name-field')).toBe(false);
    expect(has(lintDataModel([{ name: 'b', primaryField: 'code', fields: { code: { type: 'text' } } }]), 'object/missing-name-field')).toBe(false);
  });

  it('handles array-shaped fields', () => {
    const issues = lintDataModel([
      { name: 'invoice_line', fields: [{ name: 'invoice', type: 'master_detail', reference: 'invoice' }] },
    ]);
    expect(has(issues, 'relationship/master-detail-required')).toBe(true);
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
