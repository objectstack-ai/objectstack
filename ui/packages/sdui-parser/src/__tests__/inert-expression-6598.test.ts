/**
 * objectui#6598 — the html tier's silent-vanish hole for braced values this
 * tier cannot materialize.
 *
 * `interpretBrace` materializes strict JSON plus the JS literal subset
 * (objectui#6614 Q1-A, ruled 2026-08-28); a GENUINE EXPRESSION still becomes the
 * deferred `{ $expr }` marker, and NOTHING downstream evaluates that marker
 * (this tier parses, never executes — ADR-0080; a repo-wide grep finds zero
 * `$expr` consumers outside this package). Such a value reaches the renderer as
 * an opaque object, every defensive non-array read degrades it to "not
 * declared", and the author's binding is eaten in silence. That is ADR-0078's
 * prohibited parsed-but-silently-inert state, reported from production as
 * objectui#6598 (moved from objectstack#12649).
 *
 * These cases pin the correction: a `$expr` value on a DECLARED input draws the
 * warning-severity `inert-expression` diagnostic, message carrying the fix.
 * Severity stays WARNING deliberately (the objectui#5709 precedent for inert
 * authored keys); ⛔ escalation to error is objectui#6614 **Q2**, which lands at
 * the SAVE GATE once the framework wires the registry manifest into
 * `validate-jsx-pages` — not here, and not at render.
 *
 * ⭐ WHAT MOVED IN #6614 Q1-A, AND WHY IT IS NOT AN ACCIDENT. This file
 * originally pinned `columns={['name','amount']}`, `columns={[{field:"name"}]}`
 * and `options={{pageSize: 25}}` as WARNING cases, and said in so many words
 * that widening the literal grammar "should move these pins consciously, not by
 * accident". Q1-A widened it, so those three spellings now MATERIALIZE and are
 * correct — the whole point of the ruling. They moved to
 * `literal-subset-6614.test.ts`, which pins their values; each was replaced here
 * by a genuine expression, so this file still pins the same FACT (an inert
 * braced value is never silent) on the same side of the new boundary.
 *
 * The fixture manifest mirrors the LIVE `list-view` registration's relevant
 * inputs (packages/plugin-list/src/index.tsx) but is deliberately synthetic —
 * tier.test.ts's `object-table` fixture standing in for the live registration
 * is how the issue got mis-anchored in the first place. The live-path
 * (registry → SchemaRenderer → grid handoff) evidence lives in the issue
 * report, not here: this file pins the compile half.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../index.js';
import type { Manifest } from '../types.js';

const manifest: Manifest = {
  components: {
    'list-view': {
      type: 'list-view',
      namespace: 'plugin-list',
      inputs: [
        { name: 'objectName', type: 'string', required: true },
        { name: 'columns', type: 'array' },
        { name: 'options', type: 'object' },
      ],
    },
  },
};

describe('inert-expression: a braced EXPRESSION on a declared input warns instead of vanishing', () => {
  it('a method call — the shape #6598 could not materialize — warns and stays as $expr', () => {
    const r = compile(
      `<list-view objectName="account" columns={rows.map((r) => r.name)} />`,
      manifest,
    );
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'inert-expression',
        tag: 'list-view',
        message: expect.stringContaining('"columns"'),
      }),
    ]);
    // The marker itself is unchanged — the tree still carries the deferred
    // value; only the silence is gone. The message names what IS accepted.
    expect(r.tree?.columns).toEqual({ $expr: 'rows.map((r) => r.name)' });
    expect(r.diagnostics[0].message).toMatch(/LITERALS only/);
    // Warning, not error: the page still compiles (the objectui#5709 posture).
    expect(r.ok).toBe(true);
  });

  it('a bare identifier draws the same warning', () => {
    const r = compile(`<list-view objectName="account" columns={savedColumns} />`, manifest);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'inert-expression' }),
    ]);
  });

  it('an $expr on an object-typed input is covered too', () => {
    const r = compile(`<list-view objectName="account" options={{...defaults}} />`, manifest);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'inert-expression', tag: 'list-view' }),
    ]);
  });

  it('strict-JSON spellings stay diagnostic-free — the warning cannot fire on a working page', () => {
    for (const source of [
      `<list-view objectName="account" columns={["name","amount"]} />`,
      `<list-view objectName="account" columns={[{"field":"name","label":"Full Name"}]} />`,
      `<list-view objectName="account" options={{"pageSize":25}} />`,
      `<list-view objectName="account" />`,
    ]) {
      const r = compile(source, manifest);
      expect(r.diagnostics).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('an $expr on an UNKNOWN prop keeps drawing unknown-prop, not a double report', () => {
    const r = compile(`<list-view objectName="account" aggregate={someTotal(amount)} />`, manifest);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'unknown-prop' }),
    ]);
  });
});
