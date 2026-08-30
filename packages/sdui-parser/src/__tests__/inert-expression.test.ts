/**
 * `inert-expression` — the html tier's silent-vanish hole for braced values
 * this tier cannot materialize. Ported into this copy in lockstep with
 * objectui's `packages/sdui-parser` (objectui#6613, message reworded by
 * objectui#6614).
 *
 * `interpretBrace` materializes strict JSON plus the JS LITERAL SUBSET
 * (objectui#6614 Q1-A, ruled 2026-08-28); a GENUINE EXPRESSION still becomes
 * the deferred `{ $expr }` marker, and NOTHING downstream evaluates that marker
 * (this tier parses, never executes — ADR-0080; no renderer consumes `$expr`).
 * Such a value reaches the renderer as an opaque object, every defensive
 * non-array read degrades it to "not declared", and the author's binding is
 * eaten in silence. That is ADR-0078's prohibited parsed-but-silently-inert
 * state, reported from production as objectui#6598.
 *
 * WHY THIS FILE EXISTS HERE AND NOT ONLY THERE. There are two copies of this
 * parser — objectui's `packages/sdui-parser` and this repo's hoisted
 * `@objectstack/sdui-parser` — and the invariant (#12719) is that both copies
 * agree on the accepted grammar AND on diagnostic codes. If they drift, the
 * save gate and the renderer speak different dialects: a page can save clean
 * and render inert, or the reverse — surface-dependent, and therefore
 * intermittent from the author's point of view. These pins are the objectstack
 * half of that lockstep.
 *
 * ⭐ WHAT MOVED IN #6614 Q1-A, AND WHY IT IS NOT AN ACCIDENT. This file
 * originally pinned `columns={['name','amount']}`, `columns={[{field:"name"}]}`
 * and `options={{pageSize: 25}}` as WARNING cases, and said in so many words
 * that widening the literal grammar "should move these pins consciously, not by
 * accident". Q1-A widened it, so those three spellings now MATERIALIZE and are
 * correct — the whole point of the ruling. They moved to
 * `literal-subset-6614.test.ts`, which pins their values; each was replaced
 * here by a genuine expression, so this file still pins the same FACT (an inert
 * braced value is never silent) on the same side of the new boundary.
 *
 * Severity stays WARNING deliberately (the objectui#5709 precedent for inert
 * authored keys), and `ok` is pinned true alongside it: this diagnostic reports
 * an ALREADY-inert state, so it leaves the accept/reject set exactly where it
 * stood. ⛔ Escalation to error is objectui#6614 **Q2**, which lands at the SAVE
 * GATE once the framework wires the registry manifest into `validate-jsx-pages`
 * (#12719 records that gap) — not here, and not at render.
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
    // value; only the silence is gone.
    expect(r.tree?.columns).toEqual({ $expr: 'rows.map((r) => r.name)' });
    // Warning, not error: the page still compiles (the objectui#5709 posture).
    expect(r.ok).toBe(true);
  });

  it('the message names the CURRENT accepted grammar, not a now-legal spelling', () => {
    // An arrival pin, not a departure pin: "stopped being silent" is satisfied
    // by any diagnostic at all. What this port owes the author is advice that
    // is still TRUE after objectui#6614 Q1-A — the pre-#6614 wording told the
    // author to "write it as JSON (double-quoted strings and keys)" and named
    // `columns={['name','amount']}` as the wrong form, which would now send
    // them to edit working source.
    const [d] = compile(
      `<list-view objectName="account" columns={rows.map((r) => r.name)} />`,
      manifest,
    ).diagnostics;
    expect(d.message).not.toMatch(/double-quoted/);
    expect(d.message).toContain('LITERALS only');
    expect(d.message).toContain(`columns={['name','amount']} works`);
    expect(d.message).toContain('columns={rows.map((r) => r.name)} cannot');
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
    // This half is what stops the port from becoming a grammar change by
    // accident: everything `interpretBrace` materializes must stay silent.
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

  it('the accept/reject set does not move — every inert spelling still compiles', () => {
    // The load-bearing property: this diagnostic reports an ALREADY-inert
    // state, so `ok` (no error-severity diagnostic — the save gate's pass/fail)
    // is exactly what it was before the diagnostic existed. Escalating the
    // severity to error is objectui#6614's Q2 and would land here first.
    for (const source of [
      `<list-view objectName="account" columns={rows.map((r) => r.name)} />`,
      `<list-view objectName="account" columns={savedColumns} />`,
      `<list-view objectName="account" options={{...defaults}} />`,
    ]) {
      const r = compile(source, manifest);
      expect(r.ok).toBe(true);
      expect(r.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    }
  });

  it('an $expr on an UNKNOWN prop keeps drawing unknown-prop, not a double report', () => {
    const r = compile(`<list-view objectName="account" aggregate={someTotal(amount)} />`, manifest);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'unknown-prop' }),
    ]);
  });
});
