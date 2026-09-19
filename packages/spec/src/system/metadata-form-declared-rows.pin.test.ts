// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Declared keys with no form row** (#19085).
 *
 * `field.relatedListFilter` and `object.validations` were DECLARED by the
 * served schema and offered by no form in {@link METADATA_FORM_REGISTRY}, so
 * the generic metadata form never rendered them and an author's only door was
 * the Source tab — free-text JSON, where a mis-spelled sibling key is written,
 * stored, and refused later by the runtime. The two rows landed with this
 * file; this pin keeps them, and keeps the FACE each one was given.
 *
 * ## Why a pin, when a reconciliation gate already exists
 *
 * `metadata-form-zod-reconciliation.test.ts` reconciles the two directions
 * asymmetrically, and only ONE of them at the top level:
 *
 * | direction | top level | nested lists |
 * |---|---|---|
 * | form-only (offered, not declared) | checked | checked |
 * | retired (offered, tombstoned) | checked | checked |
 * | zod-only (declared, not offered) | **unchecked** | checked (ledgerable) |
 *
 * So the class this card is about — a top-level key the Zod accepts and the
 * form does not offer — is exactly the one the gate does not read, which is
 * why both keys sat missing with every gate green. Closing that direction
 * generally is not a pin: at the commit that landed this file the top-level
 * zod-only set was **276 keys across the 17 forms**, each needing an offer or
 * a ledgered reason. That census is its own card; this file pins the two keys
 * measured on #19085 so they cannot silently regress in the meantime.
 *
 * ## The faces are load-bearing, not cosmetic
 *
 * `relatedListFilter` is pinned to `filter-condition` AND against
 * `filter-builder`. The two widgets speak different wires — `filter-builder`
 * consumes a rule ARRAY, while this key is a Query-DSL `FilterCondition`, an
 * object keyed by field with `$and`/`$or`/`$not` — so "upgrading" the row to
 * the visual builder would write metadata the runtime refuses, re-creating the
 * very trap the row closes. The negative half is therefore an assertion, not a
 * comment.
 */

import { describe, it, expect } from 'vitest';

import { METADATA_FORM_REGISTRY } from './metadata-form-registry';

type FormEntry = {
  field?: string;
  widget?: string;
  type?: string;
  helpText?: string;
  visibleWhen?: string | { dialect?: string; source?: string };
  fields?: FormEntry[];
};

/**
 * Keys whose value is a canonical Query-DSL `FilterCondition` — an object
 * keyed by field with `$and`/`$or`/`$not`, NOT the rule array the visual
 * `filter-builder` writes. Named by key rather than resolved from the Zod so
 * the assertion below stays readable; both entries are pinned against their
 * schema declaration in `field.test.ts`.
 */
const FILTER_CONDITION_KEYS = new Set(['relatedListFilter', 'summaryOperations.filter']);

/** Every row of every registered form, at any depth, keyed by dotted path. */
function allRows(): Array<{ type: string; path: string; row: FormEntry }> {
  const out: Array<{ type: string; path: string; row: FormEntry }> = [];
  const walk = (type: string, entries: FormEntry[], prefix: string) => {
    for (const row of entries) {
      if (!row?.field) continue;
      const path = prefix ? `${prefix}.${row.field}` : row.field;
      out.push({ type, path, row });
      if (Array.isArray(row.fields)) walk(type, row.fields, path);
    }
  };
  for (const [type, form] of Object.entries(METADATA_FORM_REGISTRY)) {
    for (const section of ((form as any)?.sections ?? []) as Array<{ fields?: FormEntry[] }>) {
      walk(type, section.fields ?? [], '');
    }
  }
  return out;
}

/** Every top-level row of a form, across its sections. */
function topLevelRows(form: unknown): FormEntry[] {
  const rows: FormEntry[] = [];
  for (const section of ((form as any)?.sections ?? []) as Array<{ fields?: FormEntry[] }>) {
    for (const entry of section.fields ?? []) if (entry?.field) rows.push(entry);
  }
  return rows;
}

const rowsFor = (type: string) => topLevelRows(METADATA_FORM_REGISTRY[type]);
const rowFor = (type: string, key: string) => rowsFor(type).filter((r) => r.field === key);

describe('declared keys that now have a form row (#19085)', () => {
  // The probe is only a reading if it can also report a zero. Both controls
  // run against the SAME helper the assertions use, so a helper that stopped
  // finding rows would fail here rather than passing everything vacuously.
  it('CONTROLS: the row probe finds a known row and reports a known absence', () => {
    expect(rowsFor('field').length, 'the field form has top-level rows at all').toBeGreaterThan(10);
    expect(rowFor('field', 'maxLength'), 'lit control: a row that has always been offered').toHaveLength(1);
    expect(rowFor('field', 'noSuchKeyAtAll'), 'dark control: a key no form offers').toHaveLength(0);
  });

  it('field.relatedListFilter is offered, and documented', () => {
    const [row, ...extra] = rowFor('field', 'relatedListFilter');
    expect(row, '`relatedListFilter` is declared by FieldSchema; the field form must offer it').toBeDefined();
    expect(extra, 'one row only — a split offer needs disjoint visibleWhen and its own reason').toEqual([]);
    // "Loud" is the point: a row with no help text sends the author back to
    // guessing the wire, which is the Source tab with extra steps.
    expect(row.helpText?.length ?? 0).toBeGreaterThan(20);
  });

  it('field.relatedListFilter is routed to the FilterCondition widget', () => {
    const [row] = rowFor('field', 'relatedListFilter');
    expect(row.widget, 'the key is a Query-DSL FilterCondition object').toBe('filter-condition');
  });

  it('NO registered form routes a FilterCondition-typed key to the rule-array builder', () => {
    // The negative half, written so it can actually fail: it reads every row
    // of every form at every depth, not just the one this card added. A
    // future author "upgrading" either key to the visual builder — the same
    // widget `view.filter` and `dataset.filter` legitimately use — would be
    // writing an array where the runtime reads an object.
    const rows = allRows();
    expect(rows.length, 'the walk reaches rows at all').toBeGreaterThan(100);

    const matched = rows.filter((r) => FILTER_CONDITION_KEYS.has(r.path));
    // Lit control: both keys are actually reachable by this walk, so an empty
    // `misrouted` below is a measured zero rather than a walk that found
    // nothing to judge.
    expect(matched.map((r) => `${r.type}.${r.path}`).sort()).toEqual([
      'field.relatedListFilter',
      'field.summaryOperations.filter',
    ]);

    expect(
      matched.filter((r) => r.row.widget === 'filter-builder').map((r) => `${r.type}.${r.path}`),
      '`filter-builder` consumes a rule ARRAY — routing a FilterCondition key there writes metadata the runtime refuses',
    ).toEqual([]);
    // And each one still names the widget that speaks its wire.
    expect(matched.every((r) => r.row.widget === 'filter-condition')).toBe(true);
  });

  it('field.relatedListFilter is gated to the field types its contract calls meaningful', () => {
    const [row] = rowFor('field', 'relatedListFilter');
    // FieldSchema accepts the key on every type — this is a meaningfulness
    // gate, not a parse gate. The related-list derivation only ever reads it
    // on the child-side FK, so offering it elsewhere would advertise a knob
    // the runtime does not deliver.
    // `defineForm` normalises a predicate into a `{ dialect, source }`
    // envelope, so the assertion reads the envelope rather than the string it
    // was authored as.
    expect(row.visibleWhen).toEqual({ dialect: 'cel', source: "data.type in ['lookup','master_detail']" });
  });

  it('object.validations is offered, and documented with a worked example', () => {
    const [row, ...extra] = rowFor('object', 'validations');
    expect(row, '`validations` is declared by ObjectSchema; the object form must offer it').toBeDefined();
    expect(extra).toEqual([]);
    expect(row.widget, 'a double-hop $ref onto a 6-member oneOf — the passthrough control, not a derived repeater').toBe(
      'json',
    );
    // The helpText carries the shape, because the control does not: a JSON
    // door with no example is the Source tab wearing a label.
    expect(row.helpText).toContain('"type"');
    expect(row.helpText).toContain('"name"');
  });
});
