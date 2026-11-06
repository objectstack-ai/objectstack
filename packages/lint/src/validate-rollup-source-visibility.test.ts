// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `security-rollup-source-unreadable` / `security-rollup-source-row-scoped` —
// a roll-up summary a permission set reads, over child data the same set
// cannot read. The roll-up keeps its documented semantics (recomputed as the
// system over the whole child collection, read under the parent field's own
// FLS); these rules tell the author so.
//
// Every POSITIVE case below goes through the registry runner
// (`runAuthoringRules`), never through the rule function alone: a rule that is
// implemented, tested and exported but registered nowhere runs on zero stacks,
// so the positive legs must be the ones that go red when the registration does.
import { describe, expect, it } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { AUTHORING_COMMANDS, AUTHORING_RULES, runAuthoringRules, type AuthoringCommand } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';
import {
  SECURITY_ROLLUP_SOURCE_ROW_SCOPED,
  SECURITY_ROLLUP_SOURCE_UNREADABLE,
  validateRollupSourceVisibility,
} from './validate-rollup-source-visibility.js';

const UNREADABLE = 'security-rollup-source-unreadable';
const ROW_SCOPED = 'security-rollup-source-row-scoped';

type Rec = Record<string, unknown>;

/** `invoice` rolls up `sum(invoice_line.amount)` and `count(invoice_line)`. */
const invoice = (extra: Rec = {}, fields: Rec = {}): Rec => ({
  name: 'invoice',
  label: 'Invoice',
  sharingModel: 'public_read',
  fields: {
    name: { type: 'text', label: 'Name' },
    total: {
      type: 'summary',
      label: 'Total',
      summaryOperations: { object: 'invoice_line', field: 'amount', function: 'sum' },
    },
    line_count: {
      type: 'summary',
      label: 'Line Count',
      // A count names a field here on purpose: it reads no value, so the field
      // must never be judged.
      summaryOperations: { object: 'invoice_line', field: 'amount', function: 'count' },
    },
    ...fields,
  },
  ...extra,
});

const invoiceLine = (extra: Rec = {}): Rec => ({
  name: 'invoice_line',
  label: 'Invoice Line',
  sharingModel: 'public_read',
  fields: {
    name: { type: 'text', label: 'Name' },
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', required: true, deleteBehavior: 'cascade' },
    amount: { type: 'currency', label: 'Amount' },
  },
  ...extra,
});

const READ = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };

/** A set reading both objects, with `extra` merged over it. */
const set = (extra: Rec = {}): Rec => ({
  name: 'warehouse_staff',
  label: 'Warehouse Staff',
  objects: { invoice: READ, invoice_line: READ },
  ...extra,
});

const stackOf = (permission: Rec, objects: Rec[] = [invoice(), invoiceLine()]): Rec => ({
  objects,
  permissions: [permission],
});

/** What the registry runs under `command` reports for these two ids. */
const viaRegistry = (stack: Rec, command: AuthoringCommand = 'lint') =>
  runAuthoringRules(command, { normalized: stack }).filter((f) => f.rule === UNREADABLE || f.rule === ROW_SCOPED);

/** `[rule, where]` pairs, for compact assertions. */
const pairs = (findings: readonly { rule: string; where: string }[]) => findings.map((f) => [f.rule, f.where]);

const W_TOTAL = 'permission set "warehouse_staff" · summary field "invoice.total"';
const W_COUNT = 'permission set "warehouse_staff" · summary field "invoice.line_count"';

describe('security-rollup-source-unreadable — the set hides the aggregated child field (i)', () => {
  it('warns on the sum over a hidden field, through the registry', () => {
    const findings = viaRegistry(stackOf(set({ fields: { 'invoice_line.amount': { readable: false, editable: false } } })));
    // The count reads no value, so the hidden field does not reach it.
    expect(pairs(findings)).toEqual([[UNREADABLE, W_TOTAL]]);
    const [f] = findings;
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('permissions[0].fields["invoice.total"]');
  });

  it('runs on all three commands, and never as an error', () => {
    const stack = stackOf(set({ fields: { 'invoice_line.amount': { readable: false } } }));
    for (const command of AUTHORING_COMMANDS) {
      const findings = viaRegistry(stack, command);
      expect(pairs(findings), `os ${command}`).toEqual([[UNREADABLE, W_TOTAL]]);
      expect(findings.every((f) => f.severity !== 'error'), `os ${command}`).toBe(true);
    }
  });

  it('a set with NO entry for the summary column reads it — absence passes through as readable', () => {
    // The control for the hidden-summary negative below: the only difference
    // is the summary column's own entry. No entry is not a mask.
    const findings = viaRegistry(stackOf(set({ fields: { 'invoice_line.amount': { readable: false } } })));
    expect(findings.map((f) => f.where)).toContain(W_TOTAL);
    // …and an entry that leaves `readable` at its default reads it too.
    const withEntry = viaRegistry(
      stackOf(set({ fields: { 'invoice_line.amount': { readable: false }, 'invoice.total': { editable: false } } })),
    );
    expect(pairs(withEntry)).toEqual([[UNREADABLE, W_TOTAL]]);
  });

  it('a parsed permission set answers what the raw one does', () => {
    const parsed = PermissionSetSchema.parse(set({ fields: { 'invoice_line.amount': { readable: false } } })) as Rec;
    expect(pairs(viaRegistry(stackOf(parsed), 'validate'))).toEqual([[UNREADABLE, W_TOTAL]]);
  });
});

describe('security-rollup-source-unreadable — the set cannot read the child object (ii)', () => {
  it('warns on every roll-up over the child, the count included', () => {
    const findings = viaRegistry(stackOf(set({ objects: { invoice: READ } })));
    expect(pairs(findings)).toEqual([
      [UNREADABLE, W_TOTAL],
      [UNREADABLE, W_COUNT],
    ]);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('an entry on the child that grants no read is no read', () => {
    const findings = viaRegistry(
      stackOf(set({ objects: { invoice: READ, invoice_line: { allowRead: false, allowCreate: false } } })),
    );
    expect(pairs(findings)).toEqual([
      [UNREADABLE, W_TOTAL],
      [UNREADABLE, W_COUNT],
    ]);
  });

  it("a '*' read grant does not cover a private child, as at runtime", () => {
    const objects = [invoice(), invoiceLine({ access: { default: 'private' } })];
    const findings = viaRegistry(stackOf(set({ objects: { invoice: READ, '*': READ } }), objects));
    expect(pairs(findings)).toEqual([
      [UNREADABLE, W_TOTAL],
      [UNREADABLE, W_COUNT],
    ]);
  });

  it('an unreadable child object is one finding per summary, not one per arm', () => {
    const findings = viaRegistry(
      stackOf(set({ objects: { invoice: READ }, fields: { 'invoice_line.amount': { readable: false } } })),
    );
    expect(findings).toHaveLength(2);
  });
});

describe('security-rollup-source-row-scoped — a row policy narrows the child rows the set reads (iii)', () => {
  const ownLines = {
    name: 'own_lines',
    object: 'invoice_line',
    operation: 'select',
    using: 'created_by == current_user.id',
  };

  it("notes the set's own read policy on the child, at info", () => {
    const findings = viaRegistry(stackOf(set({ rowLevelSecurity: [ownLines] })));
    expect(pairs(findings)).toEqual([
      [ROW_SCOPED, W_TOTAL],
      [ROW_SCOPED, W_COUNT],
    ]);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });

  it("an 'all' policy and a '*' policy scope reads too", () => {
    expect(viaRegistry(stackOf(set({ rowLevelSecurity: [{ ...ownLines, operation: 'all' }] })))).toHaveLength(2);
    expect(viaRegistry(stackOf(set({ rowLevelSecurity: [{ ...ownLines, object: '*' }] })))).toHaveLength(2);
  });

  it("notes the child's default row scope when the set carries no read policy of its own", () => {
    const objects = [
      invoice(),
      invoiceLine({ defaultRowScope: { name: 'own_by_default', operation: 'select', using: 'created_by == current_user.id' } }),
    ];
    const findings = viaRegistry(stackOf(set(), objects));
    expect(pairs(findings)).toEqual([
      [ROW_SCOPED, W_TOTAL],
      [ROW_SCOPED, W_COUNT],
    ]);
  });

  it('names the positions a policy is narrowed to', () => {
    const [f] = viaRegistry(stackOf(set({ rowLevelSecurity: [{ ...ownLines, positions: ['picker'] }] })));
    expect(f.message).toContain('(for holders of picker)');
  });

  it('is not reported for a policy that does not scope a read', () => {
    for (const policy of [
      { ...ownLines, enabled: false },
      { ...ownLines, operation: 'update' },
      { ...ownLines, object: 'invoice' },
      { name: 'check_only', object: 'invoice_line', operation: 'all', check: 'created_by == current_user.id' },
    ]) {
      expect(viaRegistry(stackOf(set({ rowLevelSecurity: [policy] }))), JSON.stringify(policy)).toEqual([]);
    }
  });

  it("a held read-class policy displaces the child's default row scope", () => {
    const objects = [
      invoice(),
      invoiceLine({ defaultRowScope: { operation: 'select', using: 'created_by == current_user.id' } }),
    ];
    const held = { name: 'check_only', object: 'invoice_line', operation: 'all', check: 'amount >= 0' };
    expect(viaRegistry(stackOf(set({ rowLevelSecurity: [held] }), objects))).toEqual([]);
  });
});

describe('silent where the set cannot see the roll-up, or can see its source', () => {
  it('the set reads the source field and every row', () => {
    expect(viaRegistry(stackOf(set()))).toEqual([]);
    expect(
      viaRegistry(stackOf(set({ fields: { 'invoice_line.amount': { readable: true, editable: false } } }))),
    ).toEqual([]);
  });

  it('the summary column is itself hidden for the set', () => {
    const findings = viaRegistry(
      stackOf(
        set({
          objects: { invoice: READ },
          fields: { 'invoice.total': { readable: false }, 'invoice.line_count': { readable: false } },
        }),
      ),
    );
    expect(findings).toEqual([]);
  });

  it('a count roll-up over a hidden field is judged on the child object and rows only', () => {
    const hidden = { 'invoice_line.amount': { readable: false } };
    // Hidden field, readable object, no row policy: the count is silent.
    expect(viaRegistry(stackOf(set({ fields: hidden }))).map((f) => f.where)).not.toContain(W_COUNT);
    // The same count, with the object unreadable or the rows scoped, is not.
    expect(viaRegistry(stackOf(set({ objects: { invoice: READ }, fields: hidden }))).map((f) => f.where)).toContain(W_COUNT);
    const scoped = viaRegistry(
      stackOf(
        set({
          fields: { ...hidden, 'invoice.total': { readable: false } },
          rowLevelSecurity: [{ name: 'own_lines', object: 'invoice_line', operation: 'select', using: 'created_by == current_user.id' }],
        }),
      ),
    );
    expect(pairs(scoped)).toEqual([[ROW_SCOPED, W_COUNT]]);
  });

  it('the set cannot read the parent object', () => {
    expect(viaRegistry(stackOf(set({ objects: { invoice_line: READ } })))).toEqual([]);
    expect(viaRegistry(stackOf(set({ objects: {} })))).toEqual([]);
  });

  it('the set holds View All or Modify All on the child', () => {
    for (const bit of ['viewAllRecords', 'modifyAllRecords']) {
      const findings = viaRegistry(
        stackOf(
          set({
            objects: { invoice: READ, invoice_line: { ...READ, [bit]: true } },
            fields: { 'invoice_line.amount': { readable: false } },
            rowLevelSecurity: [{ name: 'own_lines', object: 'invoice_line', operation: 'select', using: 'created_by == current_user.id' }],
          }),
        ),
      );
      expect(findings, bit).toEqual([]);
    }
  });

  it("a '*' read grant covers a public child", () => {
    expect(viaRegistry(stackOf(set({ objects: { invoice: READ, '*': READ } })))).toEqual([]);
  });

  it('the child object is not defined by this stack', () => {
    expect(viaRegistry(stackOf(set({ objects: { invoice: READ } }), [invoice()]))).toEqual([]);
  });

  it('a stack with no summary field, or no permission set', () => {
    expect(viaRegistry({ objects: [invoiceLine()], permissions: [set({ objects: {} })] })).toEqual([]);
    expect(viaRegistry({ objects: [invoice(), invoiceLine()] })).toEqual([]);
  });
});

describe('a View All parent makes the summary mask inert', () => {
  it('is still reported, and the hint says the bypass must go first', () => {
    const findings = viaRegistry(
      stackOf(
        set({
          objects: { invoice: { ...READ, viewAllRecords: true } },
          fields: { 'invoice.total': { readable: false } },
        }),
      ),
    );
    expect(findings.map((f) => f.where)).toContain(W_TOTAL);
    const f = findings.find((x) => x.where === W_TOTAL)!;
    expect(f.hint).toContain('cannot be hidden from this set while it holds View All or Modify All on "invoice"');
  });
});

describe('the verdict text (the rule the author is told)', () => {
  it('states the rule for each arm', () => {
    const hidden = validateRollupSourceVisibility(
      stackOf(set({ fields: { 'invoice_line.amount': { readable: false } } })),
    );
    expect(hidden.map((f) => [f.message, f.hint])).toMatchInlineSnapshot(`
      [
        [
          ""invoice.total" summarizes "invoice_line.amount", which permission set "warehouse_staff" cannot read; a roll-up aggregates the whole child collection and follows only the parent field's own permissions",
          "Hide "invoice.total" for this set with fields["invoice.total"]: { readable: false } if its value should not be visible",
        ],
      ]
    `);

    const noObject = validateRollupSourceVisibility(stackOf(set({ objects: { invoice: READ } })));
    expect(noObject.map((f) => f.message)).toMatchInlineSnapshot(`
      [
        ""invoice.total" summarizes "invoice_line.amount", and permission set "warehouse_staff" cannot read object "invoice_line"; a roll-up aggregates the whole child collection and follows only the parent field's own permissions",
        ""invoice.line_count" counts "invoice_line" records, and permission set "warehouse_staff" cannot read object "invoice_line"; a roll-up aggregates the whole child collection and follows only the parent field's own permissions",
      ]
    `);

    const scoped = validateRollupSourceVisibility(
      stackOf(
        set({
          rowLevelSecurity: [{ name: 'own_lines', object: 'invoice_line', operation: 'select', using: 'created_by == current_user.id' }],
        }),
      ),
    );
    expect(scoped.map((f) => f.message)).toMatchInlineSnapshot(`
      [
        ""invoice.total" summarizes "invoice_line.amount" over every "invoice_line" row, while row-level policy "own_lines" narrows the rows permission set "warehouse_staff" reads; a roll-up aggregates the whole child collection and follows only the parent field's own permissions",
        ""invoice.line_count" counts every "invoice_line" row, while row-level policy "own_lines" narrows the rows permission set "warehouse_staff" reads; a roll-up aggregates the whole child collection and follows only the parent field's own permissions",
      ]
    `);
  });

  it('each verdict is one line, and each id has its explanation', () => {
    expect(SECURITY_ROLLUP_SOURCE_UNREADABLE).toBe(UNREADABLE);
    expect(SECURITY_ROLLUP_SOURCE_ROW_SCOPED).toBe(ROW_SCOPED);
    for (const id of [UNREADABLE, ROW_SCOPED]) {
      expect(explainRule(id), `no \`os explain ${id}\` entry`).toBeDefined();
    }
    const all = [
      ...validateRollupSourceVisibility(stackOf(set({ fields: { 'invoice_line.amount': { readable: false } } }))),
      ...validateRollupSourceVisibility(stackOf(set({ objects: { invoice: READ } }))),
    ];
    for (const f of all) {
      expect(f.message).not.toContain('\n');
      expect(f.hint).not.toContain('\n');
    }
  });

  it('the registry entry is advisory and declares why it is off the runtime door', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateRollupSourceVisibility');
    expect(entry?.tier).toBe('advisory');
    expect(entry?.surfaces).toEqual(['cli']);
    expect((entry?.surfaceReason ?? '').length).toBeGreaterThan(0);
  });
});
