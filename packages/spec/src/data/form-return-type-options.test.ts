// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19677 — the object designer must not OFFER a formula `returnType` the
 * schema REFUSES.
 *
 * `FieldSchema.returnType` has always been `z.enum(['number','text','boolean',
 * 'date'])`. The object designer's quick-add grid (`object.form.ts`, the
 * `fields` repeater) declared an inline `options` list of SIX — the four plus
 * `datetime` and `currency` — so an author who added a formula field there and
 * picked either of the extra two wrote a value the parse refuses. The failure
 * is silent at the point of choice: the select is populated from that inline
 * list, nothing reconciles it with the enum, and the refusal arrives later from
 * the save door naming a key the author never typed.
 *
 * The exit is a pull-back, not a decision about what a formula may return. Two
 * carriers in this package already spelled the accept set correctly — the enum
 * itself, and the field designer's own control in `field.form.ts` (four
 * members, explicit list). Narrowing the grid makes it three.
 *
 * ## Why the four, and not the six
 *
 * The producer side agrees with the enum, not with the grid: authoring stamps
 * `returnType` from the inferred CEL type, and that inference is typed
 * `number | text | boolean | date | unknown` (`@objectstack/formula`'s
 * `inferExpressionType`). There is no path by which the platform stamps
 * `datetime` or `currency`, so the six-member list was never a capability that
 * existed and got broken — it was an offer with nothing behind it.
 *
 * ## Why the expectation is DERIVED and not four literals
 *
 * A test asserting the row's `options` against a hard-coded list of four rots
 * exactly the way the bug did: the enum moves, the literals do not, and the
 * test keeps passing over a control that has drifted again. So the expected set
 * is read from `FieldSchema` at runtime, through the same JSON-Schema view the
 * metadata-admin renderer falls back to when a row declares no `options` at
 * all. If the enum gains or loses a member, this file fails until the forms
 * move with it.
 *
 * ## What the historical-roster assertions are for
 *
 * The two removed members are additionally pinned as REFUSED-and-UNOFFERED.
 * That is not a duplicate of the set equality: it is the pin that fires if the
 * platform ever decides a formula may return a datetime or a currency. Widening
 * the enum is a product decision with its own card, and this is where it is
 * made to notice that the two forms must move in the same change.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { objectForm } from './object.form';
import { fieldForm } from './field.form';
import { FieldSchema } from './field.zod';
import { FormViewSchema } from '../ui/view.zod';

// ────────────────────────────────────────────────────────────────────────────
// The expectation, DERIVED from the schema at runtime.
// ────────────────────────────────────────────────────────────────────────────

/**
 * `returnType`'s declared members, read off `FieldSchema` itself. This is also
 * the renderer's derived option source — what a row with no inline `options`
 * would offer — so a form that declares nothing and a form that declares the
 * full list are judged against one authority.
 */
function schemaReturnTypeMembers(): string[] {
  const js = z.toJSONSchema(FieldSchema as unknown as z.ZodType, {
    unrepresentable: 'any',
    io: 'input',
  }) as { properties?: Record<string, { enum?: unknown[] }> };
  const node = js.properties?.returnType;
  if (!node) throw new Error('FieldSchema no longer exposes a `returnType` JSON Schema node');
  if (!Array.isArray(node.enum)) {
    throw new Error(
      '`FieldSchema.returnType` no longer resolves to a closed enum in the JSON Schema view; '
        + 'this test derives its expectation from that enum and cannot judge the forms without it.',
    );
  }
  return node.enum.map((m) => String(m));
}

/**
 * The members this round removed from the grid. Deliberately literal: they are
 * a record of what was wrongly offered, not the expectation — the expectation
 * above is derived. If one of these ever becomes a declared member, the
 * assertions below fail and the forms are re-opened on purpose.
 */
const HISTORICALLY_OFFERED_NON_MEMBERS = ['datetime', 'currency'] as const;

// ────────────────────────────────────────────────────────────────────────────
// Locating the declarations
// ────────────────────────────────────────────────────────────────────────────

type Decl = { path: string; spec: Record<string, unknown> };

/** Every form-field spec named `key`, at any depth (sections, repeater rows). */
function findDeclarations(node: unknown, key: string, path = '$', out: Decl[] = []): Decl[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n, i) => findDeclarations(n, key, `${path}[${i}]`, out));
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (rec.field === key) out.push({ path, spec: rec });
  for (const child of ['sections', 'fields'] as const) {
    if (rec[child]) findDeclarations(rec[child], key, `${path}.${child}`, out);
  }
  return out;
}

/** Declared option VALUES, or `undefined` when the spec has no inline list. */
function declaredOptionValues(spec: Record<string, unknown>): string[] | undefined {
  const opts = spec.options;
  if (!Array.isArray(opts) || opts.length === 0) return undefined;
  return opts.map((o) => String((o as { value?: unknown }).value));
}

/**
 * What a form actually offers for `returnType`: its inline list, or — when it
 * declares none — the derived enum the renderer falls back to. Both spellings
 * are a full offer and are judged against the same expected set, so neither can
 * drift unnoticed.
 */
function offeredValues(decl: Decl): string[] {
  return declaredOptionValues(decl.spec) ?? schemaReturnTypeMembers();
}

const FORMS = [
  { name: 'objectForm', form: objectForm as unknown },
  { name: 'fieldForm', form: fieldForm as unknown },
] as const;

/** A minimal formula field carrying one `returnType`, for a full parse. */
function formulaFieldWith(returnType: string): Record<string, unknown> {
  return {
    name: 'line_total',
    label: 'Line Total',
    type: 'formula',
    expression: 'record.quantity * record.unit_price',
    returnType,
  };
}

// ────────────────────────────────────────────────────────────────────────────

describe('#19677 — `returnType` is never offered a value the schema refuses', () => {
  it('derives a non-empty closed member set from FieldSchema', () => {
    // The floor for every assertion below: an empty or unreadable derivation
    // would make the set-equality checks vacuously true.
    const members = schemaReturnTypeMembers();
    expect(members.length).toBeGreaterThan(0);
    expect(new Set(members).size).toBe(members.length);
  });

  for (const { name, form } of FORMS) {
    describe(name, () => {
      const decls = findDeclarations(form, 'returnType');

      it('declares exactly one `returnType` control — no overlap, no gap', () => {
        // Two declarations of one key have two ways to go wrong that a bare
        // "datetime is absent" assertion would not see: both rendering (two
        // selects writing one key), or a narrowing applied to only one of them.
        expect(decls.map((d) => d.path)).toHaveLength(1);
      });

      it('offers exactly the members FieldSchema declares — no more, no fewer', () => {
        const offered = offeredValues(decls[0]);
        expect([...offered].sort()).toEqual([...schemaReturnTypeMembers()].sort());
      });

      // THE DEFECT, stated as the value-level judgment: every value this
      // control can write must survive a full parse. A key-level check would
      // pass on the broken grid — `returnType` was always a recognised key.
      it('offers only values that a formula field actually parses with', () => {
        for (const value of offeredValues(decls[0])) {
          const parsed = (FieldSchema as unknown as z.ZodType).safeParse(formulaFieldWith(value));
          expect(
            parsed.success,
            `${name} offers returnType '${value}', which FieldSchema refuses: `
              + JSON.stringify((parsed as { error?: unknown }).error),
          ).toBe(true);
        }
      });

      it('offers neither of the two members the grid used to carry', () => {
        const offered = offeredValues(decls[0]);
        for (const value of HISTORICALLY_OFFERED_NON_MEMBERS) {
          expect(offered).not.toContain(value);
        }
      });

      it('is expressible in the form DSL as it stands — no schema extension', () => {
        // `defineForm` parses at module load; re-parsing makes the claim an
        // assertion rather than an import side effect.
        const parsed = (FormViewSchema as unknown as z.ZodType).safeParse(form);
        expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
      });
    });
  }

  it('the two removed members are refused by the schema, which is why they went', () => {
    // The justification for the narrowing, asserted rather than asserted-about.
    // Should the platform ever declare one of these, this fails and the two
    // forms are re-opened in the same change that widens the enum.
    for (const value of HISTORICALLY_OFFERED_NON_MEMBERS) {
      expect(schemaReturnTypeMembers()).not.toContain(value);
      const parsed = (FieldSchema as unknown as z.ZodType).safeParse(formulaFieldWith(value));
      expect(parsed.success, `FieldSchema unexpectedly accepts returnType '${value}'`).toBe(false);
    }
  });

  it('the object designer and the field designer offer the same list, in the same order', () => {
    const lists = FORMS.map(({ form }) => offeredValues(findDeclarations(form, 'returnType')[0]));
    expect(lists[0]).toEqual(lists[1]);
  });
});
