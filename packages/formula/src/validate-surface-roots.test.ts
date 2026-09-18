// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ExprSchemaHint.roots` — an authoring surface naming the binding roots it
 * mounts beyond the platform baseline, so the validator can accept them
 * WITHOUT standing down on everything else.
 *
 * ## The defect this closes
 *
 * A page component's `visibleWhen` binds three roots at runtime. Before this
 * key the hint could express two shapes and neither was that surface:
 *
 *   - `scope: 'record'`    refused `page.selectedProjectId != ''` — the example
 *                          `packages/spec/src/ui/page.zod.ts`'s own `visibleWhen`
 *                          describe ends with, under a sentence naming the
 *                          contract-bound roots as `record`, `current_user` and
 *                          「page state as `page.<var>`」 — and prescribed
 *                          `record.page`, which names nothing on any layer.
 *                          Downstream that refusal disables Save in the designer.
 *   - `scope: 'flattened'` accepted it, and accepted a bare `status` with it,
 *                          which is the shorthand the narrowing exists to catch.
 *
 * ⛔ The repair is NOT "make the validator permissive at that surface": trading
 * a false refusal for a silent acceptance is the worse of the two directions
 * here. A surface declares WHICH roots it binds, and every other name keeps the
 * verdict it had.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * The assertions are about the NAMED SUBJECT of each verdict — which reference
 * is judged, and which spelling is prescribed — never the sentence around it.
 * `ExprValidationError` carries no code or status, so the prescribed spelling
 * IS the machine-readable part of the contract for the two rows where a
 * prescription is the defect; the rest of the wording is free to change.
 */

import { describe, it, expect } from 'vitest';

import { SCOPE_ROOTS } from './cel-engine';
import { introspectScope, validateExpression } from './validate';

/**
 * The spec's own worked example for `PageComponent.visibleWhen`, copied from
 * the `.describe()` in `packages/spec/src/ui/page.zod.ts` rather than invented
 * here. It is the sharpest form of the defect: the one spelling the platform
 * publishes for this key was the one the `record` scope refused.
 */
const SPEC_PAGE_EXAMPLE = "page.selectedProjectId != ''";

/** The bare-field shorthand a page block's `visibleWhen` must keep refusing. */
const BARE_FIELD = "status == 'done'";

/** What the page surface mounts beyond the platform baseline. */
const PAGE_SURFACE_ROOTS = ['page'] as const;

describe('ExprSchemaHint.roots — a surface declaring the roots it binds', () => {
  it('`page` is not in the platform baseline, and that is why the hint is needed', () => {
    // Read from the list, never copied: if `page` is ever added to the baseline
    // this row goes red and the premise below has to be re-argued.
    expect(SCOPE_ROOTS as readonly string[]).not.toContain('page');
    expect(SCOPE_ROOTS as readonly string[]).toContain('current_user');
  });

  describe("the card's repro — the spec's own `page.var` example", () => {
    it('is refused under `record` scope with no declared roots (the defect)', () => {
      const r = validateExpression('predicate', SPEC_PAGE_EXAMPLE, { scope: 'record' });
      expect(r.ok).toBe(false);
      // The named subject is `page`, and the prescription is the meaningless one.
      expect(r.errors[0].message).toContain('`page`');
      expect(r.errors[0].message).toContain('record.page');
    });

    it('resolves once the surface declares `page` as one of its roots', () => {
      const r = validateExpression('predicate', SPEC_PAGE_EXAMPLE, {
        scope: 'record',
        roots: PAGE_SURFACE_ROOTS,
      });
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
    });
  });

  describe('declaring a root does NOT make the surface permissive', () => {
    it('still refuses the bare-field shorthand, with the `record.` prescription', () => {
      const r = validateExpression('predicate', BARE_FIELD, {
        scope: 'record',
        roots: PAGE_SURFACE_ROOTS,
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toContain('`status`');
      expect(r.errors[0].message).toContain('record.status');
    });

    it('still refuses a root the surface did NOT declare', () => {
      const r = validateExpression('predicate', "wizard.step == 2", {
        scope: 'record',
        roots: PAGE_SURFACE_ROOTS,
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toContain('`wizard`');
    });

    it('judges the declared root and the bare field in one source, refusing on the field', () => {
      const r = validateExpression('predicate', `${SPEC_PAGE_EXAMPLE} && ${BARE_FIELD}`, {
        scope: 'record',
        roots: PAGE_SURFACE_ROOTS,
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toContain('`status`');
    });
  });

  describe('the refusal names the roots the surface does bind', () => {
    it('sends a typo of a declared root to that root, not to `record.<typo>`', () => {
      const r = validateExpression('predicate', "pge.selectedProjectId != ''", {
        scope: 'record',
        roots: PAGE_SURFACE_ROOTS,
      });
      expect(r.ok).toBe(false);
      const [{ message }] = r.errors;
      expect(message).toContain('`pge`');
      expect(message).toContain('`page`');
      // ⛔ The prescription the card calls meaningless must not be the one an
      // author is handed for a mistyped ROOT.
      expect(message).not.toContain('record.pge');
    });

    it('leaves a bare VALUE reference on the generic message even when roots are declared', () => {
      // `pge` here is not written as a namespace, so nothing says it is a
      // mistyped root rather than a mistyped field.
      const r = validateExpression('predicate', "pge == 'x'", {
        scope: 'record',
        roots: PAGE_SURFACE_ROOTS,
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toContain('record.pge');
    });

    it('keeps `record.<field>` for a known field used as a namespace (a JSON member)', () => {
      const r = validateExpression('predicate', "address.city == 'SF'", {
        scope: 'record',
        roots: PAGE_SURFACE_ROOTS,
        fields: ['address'],
      });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toContain('record.address');
    });
  });

  describe('every existing call site is unmoved', () => {
    it.each([
      ['no hint at all', undefined],
      ['`roots` absent', { scope: 'record' as const }],
      ['`roots` empty', { scope: 'record' as const, roots: [] }],
    ])('%s → the pre-existing verdict and prescription', (_label, schema) => {
      const r = validateExpression('predicate', SPEC_PAGE_EXAMPLE, schema);
      if (schema === undefined) {
        // No `scope` ⇒ the bare-ref check does not run at all; unchanged.
        expect(r.ok).toBe(true);
        return;
      }
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toContain('record.page');
    });
  });

  describe('the flattened face', () => {
    it('does not report a declared root as a typo of a near-miss field', () => {
      // Without the declaration this warns 「did you mean `pages`?」 — advice on
      // a root the surface really does bind.
      const r = validateExpression('predicate', SPEC_PAGE_EXAMPLE, {
        scope: 'flattened',
        fields: ['pages', 'status'],
        objectName: 'project',
        roots: PAGE_SURFACE_ROOTS,
      });
      expect(r.ok).toBe(true);
      expect(r.warnings).toEqual([]);
    });

    it('still warns for that same near-miss when the root is NOT declared', () => {
      const r = validateExpression('predicate', SPEC_PAGE_EXAMPLE, {
        scope: 'flattened',
        fields: ['pages', 'status'],
        objectName: 'project',
      });
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toContain('`pages`');
    });
  });

  describe('introspection advertises what the validator accepts', () => {
    it('adds the declared roots to the authoring vocabulary', () => {
      const { roots } = introspectScope('predicate', { scope: 'record', roots: PAGE_SURFACE_ROOTS });
      expect(roots).toContain('page');
      expect(roots).toContain('record');
    });

    it('is unchanged when no roots are declared', () => {
      expect(introspectScope('predicate').roots).toEqual(
        introspectScope('predicate', { scope: 'record' }).roots,
      );
      expect(introspectScope('predicate').roots).not.toContain('page');
    });

    it('does not duplicate a root that is already advertised', () => {
      const { roots } = introspectScope('predicate', { roots: ['record', 'page'] });
      expect(roots.filter((r) => r === 'record')).toHaveLength(1);
    });
  });
});
