// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11410 — the field designer must not OFFER a `deleteBehavior` the schema
 * REFUSES.
 *
 * #9689 (PR #11406) made `deleteBehavior: 'set_null'` authored on a
 * `master_detail` a named parse-time rejection. The two metadata forms that let
 * a Studio author pick that value did not move with it: both declared ONE
 * `deleteBehavior` control shared by `lookup` and `master_detail`, so a
 * `master_detail` author was still offered "Set null", picked it, and learned
 * only at publish (422) that the choice was never legal. Declared-vs-enforced,
 * one seam earlier than the parse door.
 *
 * ## The two forms failed the same way through DIFFERENT option sources
 *
 * - `object.form.ts` declared an inline `options` array carrying all three
 *   values, gated by one `visibleWhen` naming both types.
 * - `field.form.ts` declared NO `options` at all. That is not a narrower
 *   offer — it is the renderer's DERIVED source: with no `fieldSpec.options`
 *   the metadata-admin form falls through to the JSON Schema `enum`, which is
 *   `['set_null','cascade','restrict']` and additionally advertises
 *   `default: 'set_null'`. A Zod enum has no per-type narrowing to give, so the
 *   derived path re-offers the refused value by construction.
 *
 * Both are asserted below, and the derived-source half is asserted as a FACT
 * about the enum rather than assumed — it is the reason the `master_detail`
 * branch must carry an EXPLICIT list instead of simply omitting one.
 *
 * ## Why two selects with disjoint `visibleWhen`, and not per-option visibility
 *
 * `SelectOptionSchema` does declare a per-option `visibleWhen` (ADR-0068 /
 * objectui#2284), so "hide just this option" looks like existing vocabulary.
 * It is not reachable from a metadata form, measured twice:
 *
 *  1. The metadata-admin renderer (objectui `SchemaForm.tsx`) maps
 *     `fieldSpec.options` straight to `<SelectItem>` and never consults
 *     `opt.visibleWhen`. Writing one would ship an ADR-0049
 *     declared-but-unenforced key — the author would still be offered
 *     "Set null".
 *  2. Where per-option visibility IS honored (the runtime form's
 *     `resolveCascadingOptions` -> `evalFieldPredicate`), the predicate scope
 *     binds `record` / `previous` / `extra` and has NO `data`. A metadata form
 *     spells its predicates `data.*`, so a `data.`-rooted per-option predicate
 *     is an unbound identifier, and visibility's fallback is TRUE — the option
 *     would be KEPT. A fix that silently does nothing.
 *
 * Field-level `visibleWhen` has neither problem: it is the predicate the
 * renderer already evaluates as `evaluatePredicate(visibility, { data })` for
 * every other type-conditional control in these two files. So the shape is two
 * declarations of the same key with disjoint predicates — the existing
 * vocabulary the triage fence named.
 *
 * ## What each assertion is protecting
 *
 * `exactly one visible declaration per type` is not a tidiness check. Two
 * declarations of one key have two ways to go wrong that a bare
 * "set_null is absent" assertion would not see: predicates that OVERLAP (both
 * controls render, two selects writing one key) and predicates that leave a
 * GAP (neither renders, the control silently disappears for that type — the
 * same fail-CLOSED disappearance objectstack#6936 was filed about).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { objectForm } from './object.form';
import { fieldForm } from './field.form';
import { FieldSchema } from './field.zod';
import { FormViewSchema } from '../ui/view.zod';

// ────────────────────────────────────────────────────────────────────────────
// The derived option source — what a declaration with NO `options` offers.
// ────────────────────────────────────────────────────────────────────────────

/** `deleteBehavior`'s JSON Schema node, as the renderer's fallback reads it. */
function derivedDeleteBehaviorNode(): { enum?: unknown[]; default?: unknown } {
  const js = z.toJSONSchema(FieldSchema as unknown as z.ZodType, {
    unrepresentable: 'any',
    io: 'input',
  }) as { properties?: Record<string, { enum?: unknown[]; default?: unknown }> };
  const node = js.properties?.deleteBehavior;
  if (!node) throw new Error('FieldSchema no longer exposes a `deleteBehavior` JSON Schema node');
  return node;
}

// ────────────────────────────────────────────────────────────────────────────
// A deliberately tiny mirror of the metadata-admin predicate subset.
//
// This evaluator understands ONLY the spellings these two forms use. Anything
// else THROWS rather than defaulting to "visible": a test that quietly assumed
// visibility for a predicate it could not read would go green on a form it
// never actually evaluated. Fail-closed on drift is the whole point — note this
// is the opposite of the RENDERER's fail-open default, and deliberately so. The
// renderer must not hide a control it cannot parse; a gate must not bless one.
// ────────────────────────────────────────────────────────────────────────────

/** `visibleWhen` survives the parse as `{ dialect, source }`; accept both forms. */
function predicateSource(spec: Record<string, unknown>): string | undefined {
  const raw = spec.visibleWhen;
  if (raw == null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && typeof (raw as { source?: unknown }).source === 'string') {
    return (raw as { source: string }).source;
  }
  throw new Error(`unreadable visibleWhen on '${String(spec.field)}': ${JSON.stringify(raw)}`);
}

/** Evaluate one `data.type`-rooted clause. Throws on any unrecognised spelling. */
function evalClause(clause: string, type: string): boolean {
  const src = clause.trim().replace(/^\(|\)$/g, '').trim();

  const eq = /^data\.type\s*==\s*'([^']*)'$/.exec(src);
  if (eq) return type === eq[1];

  const ne = /^data\.type\s*!=\s*'([^']*)'$/.exec(src);
  if (ne) return type !== ne[1];

  const inList = /^data\.type\s+in\s+\[([^\]]*)\]$/.exec(src);
  if (inList) {
    const members = inList[1]
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0)
      .map((m) => {
        const lit = /^'([^']*)'$/.exec(m);
        if (!lit) throw new Error(`non-literal member in \`in\` list: ${m}`);
        return lit[1];
      });
    return members.includes(type);
  }

  throw new Error(`predicate spelling not covered by this test's evaluator: ${JSON.stringify(src)}`);
}

/** Evaluate a whole predicate (a `||` chain of clauses) for a given `data.type`. */
function isVisibleForType(spec: Record<string, unknown>, type: string): boolean {
  const src = predicateSource(spec);
  if (src === undefined) return true;
  return src.split('||').some((clause) => evalClause(clause, type));
}

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

const FORMS = [
  { name: 'objectForm', form: objectForm as unknown },
  { name: 'fieldForm', form: fieldForm as unknown },
] as const;

// ────────────────────────────────────────────────────────────────────────────

describe('#11410 — `deleteBehavior` is never offered a value the schema refuses', () => {
  describe('the derived option source, which is why an explicit list is required', () => {
    it('offers all three values, and defaults to the one a master_detail refuses', () => {
      const node = derivedDeleteBehaviorNode();
      // A declaration with no inline `options` inherits exactly this set. It
      // carries no per-type narrowing, so `master_detail` cannot be served by
      // omission — only by an explicit list.
      expect(node.enum).toEqual(['set_null', 'cascade', 'restrict']);
      expect(node.default).toBe('set_null');
    });
  });

  for (const { name, form } of FORMS) {
    describe(name, () => {
      const decls = findDeclarations(form, 'deleteBehavior');

      it('declares the control at all', () => {
        expect(decls.length, 'no `deleteBehavior` control found').toBeGreaterThan(0);
      });

      it('offers exactly one control to a master_detail author — no overlap, no gap', () => {
        const visible = decls.filter((d) => isVisibleForType(d.spec, 'master_detail'));
        expect(visible.map((d) => d.path)).toHaveLength(1);
      });

      it('offers exactly one control to a lookup author — no overlap, no gap', () => {
        const visible = decls.filter((d) => isVisibleForType(d.spec, 'lookup'));
        expect(visible.map((d) => d.path)).toHaveLength(1);
      });

      // THE DEFECT. A master_detail author must never see "Set null".
      it('does not offer set_null to a master_detail author', () => {
        const visible = decls.filter((d) => isVisibleForType(d.spec, 'master_detail'));
        for (const d of visible) {
          const values = declaredOptionValues(d.spec);
          // An absent list is NOT a pass: it resolves to the derived enum,
          // which carries set_null. The master_detail branch must narrow
          // explicitly.
          expect(
            values,
            `${d.path} declares no inline options, so it falls through to the derived enum `
              + `(which offers set_null). The master_detail branch must declare an explicit list.`,
          ).toBeDefined();
          expect(values).not.toContain('set_null');
          expect(values).toEqual(['cascade', 'restrict']);
        }
      });

      // The other half of the ruling: nothing is taken away from `lookup`,
      // where all three outcomes remain legal.
      it('still offers all three values to a lookup author', () => {
        const visible = decls.filter((d) => isVisibleForType(d.spec, 'lookup'));
        expect(visible).toHaveLength(1);
        const values = declaredOptionValues(visible[0].spec);
        // Either spelling is a full offer: an explicit three-value list, or no
        // list at all (deriving the same three from the schema enum). Both are
        // asserted against the same expected set so neither form can narrow
        // `lookup` unnoticed.
        const offered = values ?? (derivedDeleteBehaviorNode().enum as string[]);
        expect(offered).toEqual(['set_null', 'cascade', 'restrict']);
      });

      it('is expressible in the form DSL as it stands — no schema extension', () => {
        // `defineForm` already parses at module load; re-parsing makes the
        // claim an assertion rather than an import side effect. If the fix had
        // needed a key the DSL does not declare, this is where it would fail.
        const parsed = (FormViewSchema as unknown as z.ZodType).safeParse(form);
        expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
      });
    });
  }

  it('the two forms agree on what a master_detail may be offered', () => {
    const sets = FORMS.map(({ form }) =>
      findDeclarations(form, 'deleteBehavior')
        .filter((d) => isVisibleForType(d.spec, 'master_detail'))
        .flatMap((d) => declaredOptionValues(d.spec) ?? ['<derived>']),
    );
    expect(sets[0]).toEqual(sets[1]);
  });
});
