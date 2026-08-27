/**
 * `inert-expression` — the html tier's silent-vanish hole for braced non-JSON
 * values, ported into this copy in lockstep with objectui PR #6613.
 *
 * `interpretBrace` materializes strict-JSON values only; anything else — the
 * single-quoted array every JSX author writes, unquoted object keys, any JS
 * expression — becomes the deferred `{ $expr }` marker, and NOTHING downstream
 * evaluates that marker (this tier parses, never executes — ADR-0080; no
 * renderer consumes `$expr`). So `columns={['name','amount']}` used to compile
 * with ZERO diagnostics into a value every renderer's defensive non-array read
 * degrades to "no columns declared": rows render, the author's whole data
 * binding is eaten, and no surface ever says why. That is ADR-0078's prohibited
 * parsed-but-silently-inert state, reported from production as objectui#6598.
 *
 * WHY THIS FILE EXISTS HERE AND NOT ONLY THERE. There are two copies of this
 * parser — objectui's `packages/sdui-parser` and this repo's hoisted
 * `@objectstack/sdui-parser` — and the invariant is that both copies agree on
 * the accepted grammar AND on diagnostic codes. If they drift, the save gate
 * and the renderer speak different dialects: a page can save clean and render
 * inert, or the reverse — surface-dependent, and therefore intermittent from
 * the author's point of view. These pins are the objectstack half of that
 * lockstep; the emitted diagnostic is byte-equal to objectui's.
 *
 * Severity is pinned as WARNING deliberately (the objectui#5709 precedent for
 * inert authored keys), and `ok` is pinned true alongside it: this port reports
 * an ALREADY-inert state, so it must leave the accept/reject set exactly where
 * it stood. Escalating to error, widening the accepted literal grammar (single
 * quotes / unquoted keys — objectui#6614), and base-prop (`style`) coverage are
 * open contract decisions; a change to any of those should move these pins
 * consciously, not by accident.
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

describe('inert-expression: braced non-JSON on a declared input warns instead of vanishing', () => {
  it('single-quoted array — the JSX habit — draws the warning and stays in the tree as $expr', () => {
    const r = compile(`<list-view objectName="account" columns={['name','amount']} />`, manifest);
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
    expect(r.tree?.columns).toEqual({ $expr: "['name','amount']" });
  });

  it('the message carries the FIX, not merely the complaint', () => {
    // An arrival pin, not a departure pin: "stopped being silent" is satisfied
    // by any diagnostic at all. What this port owes the author is the remedy —
    // name JSON, and show the corrected spelling next to the broken one. A
    // message rewrite that drops the remedy turns this red.
    const [d] = compile(
      `<list-view objectName="account" columns={['name','amount']} />`,
      manifest,
    ).diagnostics;
    expect(d.message).toMatch(/JSON/);
    expect(d.message).toContain('double-quoted strings and keys');
    expect(d.message).toContain('columns={["name","amount"]}');
    expect(d.message).toContain(`columns={['name','amount']}`);
  });

  it('unquoted object keys draw the same warning', () => {
    const r = compile(`<list-view objectName="account" columns={[{field:"name"}]} />`, manifest);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'inert-expression' }),
    ]);
  });

  it('an $expr on an object-typed input is covered too', () => {
    const r = compile(`<list-view objectName="account" options={{pageSize: 25}} />`, manifest);
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
    // The load-bearing property of this port: it reports an ALREADY-inert
    // state, so `ok` (no error-severity diagnostic — the save gate's pass/fail)
    // is exactly what it was before the diagnostic existed. Escalating the
    // severity to error is objectui#6614's Q2 and would land here first.
    for (const source of [
      `<list-view objectName="account" columns={['name','amount']} />`,
      `<list-view objectName="account" columns={[{field:"name"}]} />`,
      `<list-view objectName="account" options={{pageSize: 25}} />`,
    ]) {
      const r = compile(source, manifest);
      expect(r.ok).toBe(true);
      expect(r.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    }
  });

  it('an $expr on an UNKNOWN prop keeps drawing unknown-prop, not a double report', () => {
    const r = compile(`<list-view objectName="account" aggregate={{field:'amount'}} />`, manifest);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'unknown-prop' }),
    ]);
  });
});
