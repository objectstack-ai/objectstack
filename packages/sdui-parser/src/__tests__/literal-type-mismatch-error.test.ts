/**
 * A LITERAL whose coarse type no declared arm accepts is an `error`.
 *
 * `checkType` used to grade `type-mismatch` `error` only when an `enum` arm was
 * present, on the ground that an enum's closed list was the one fact the layer
 * could be certain about. A literal's coarse type is a second certain fact:
 * every value that reaches `checkType` is a literal, because a braced value the
 * parser cannot materialize becomes the `{ $expr }` marker and `validateTree`
 * diverts it to `inert-expression` first. So `aggregate="count"` on an
 * `object-metric` compiled `ok` with one warning, `os build` stayed green, and
 * the tile, which reads `aggregate.function`, drew nothing.
 *
 * The inputs below are copied verbatim from the tracked `sdui.manifest.json`
 * (the file `os build` resolves through `packages/cli/src/utils/sdui-manifest.ts`)
 * and written inline, so this package's tests read nothing outside it.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../index.js';
import type { Manifest } from '../types.js';

const manifest: Manifest = {
  components: {
    'object-metric': {
      type: 'object-metric',
      namespace: 'ui',
      inputs: [
        { name: 'objectName', type: 'string', required: true },
        { name: 'label', type: ['string', 'object'] },
        { name: 'aggregate', type: 'object' },
        { name: 'invert', type: 'boolean' },
        { name: 'filter', type: 'array' },
      ],
    },
    'object-kanban': {
      type: 'object-kanban',
      namespace: 'ui',
      inputs: [{ name: 'limit', type: 'number' }],
    },
  },
};

describe('a literal no declared arm accepts is an error', () => {
  it('aggregate="count" on an object-typed input: error, and the compile is not ok', () => {
    const r = compile(
      `<object-metric objectName="ticket" aggregate="count" label="Open tickets" />`,
      manifest,
    );
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'type-mismatch',
        message: '<object-metric> prop "aggregate" expected an object',
        tag: 'object-metric',
      },
    ]);
    expect(r.ok).toBe(false);
  });

  it('aggregate={{"function":"count"}} is clean', () => {
    const r = compile(
      `<object-metric objectName="ticket" aggregate={{"function":"count"}} label="Open tickets" />`,
      manifest,
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('a string literal on a number input is an error', () => {
    const r = compile(`<object-kanban limit="50" />`, manifest);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([['error', 'type-mismatch']]);
    expect(r.ok).toBe(false);
  });

  it('a string literal on a boolean input is an error', () => {
    const r = compile(`<object-metric objectName="ticket" invert="true" />`, manifest);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([['error', 'type-mismatch']]);
    expect(r.ok).toBe(false);
  });

  it('a string literal on an array input is an error', () => {
    const r = compile(`<object-metric objectName="ticket" filter="status = open" />`, manifest);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([['error', 'type-mismatch']]);
    expect(r.ok).toBe(false);
  });
});

describe('an expression is not a literal and stays a warning', () => {
  it('an expression handed to an object input draws the inert-expression warning, never type-mismatch', () => {
    const r = compile(`<object-metric objectName="ticket" aggregate={count} />`, manifest);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([['warning', 'inert-expression']]);
    expect(r.ok).toBe(true);
  });

  it('a container holding an expression is one expression, not a literal with one bad member', () => {
    const r = compile(`<object-metric objectName="ticket" filter={["status", status]} />`, manifest);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([['warning', 'inert-expression']]);
    expect(r.ok).toBe(true);
  });
});
