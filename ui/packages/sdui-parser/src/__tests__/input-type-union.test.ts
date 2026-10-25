/**
 * ObjectUI — `ManifestInput.type` as a union of arms (objectui#3832)
 *
 * The mechanism half of the card; the user-visible half (the five measured
 * specimens, through the manifest the console really builds) lives in
 * `apps/console/src/__tests__/component-input-union-specimens.test.ts`.
 *
 * Three facts are pinned here, and they are different facts:
 *
 *  1. ANY-ARM — a value passes when any declared arm accepts it, and is still
 *     reported when none does. The second half is the one that can rot silently:
 *     a `switch (input.type)` handed an array falls into its default branch and
 *     returns null, so a broken implementation looks exactly like a clean value.
 *  2. BACKWARD COMPATIBILITY — a single-kind declaration behaves and serializes
 *     byte-identically to before. This is what makes the change an extension of
 *     `sdui.manifest.json` rather than a new version of it.
 *  3. THE CONSUMERS — the serializer canonicalizes (collapse one arm, drop an
 *     off-vocabulary arm, dedupe) and the JSX codegen emits a TS union. A
 *     declaration the gate honours but the `.d.ts` contradicts would just move
 *     the author's false error one layer over.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalizeInputType,
  compile,
  generateDts,
  inputTypeArms,
  manifestFromConfigs,
  validateTree,
} from '../index.js';
import type { Manifest, SchemaElement } from '../types.js';

const one = (inputs: Parameters<typeof manifestFromConfigs>[0][number]['inputs']): Manifest =>
  manifestFromConfigs([{ type: 'probe', namespace: 'ui', inputs }]);

const codes = (manifest: Manifest, node: Record<string, unknown>): string[] =>
  validateTree({ type: 'probe', ...node } as SchemaElement, manifest).diagnostics.map(
    (d) => d.code,
  );

const messages = (manifest: Manifest, node: Record<string, unknown>): string[] =>
  validateTree({ type: 'probe', ...node } as SchemaElement, manifest).diagnostics.map(
    (d) => d.message,
  );

describe('any declared arm accepts the value', () => {
  const manifest = one([{ name: 'title', type: ['string', 'object'] }]);

  it('accepts either arm', () => {
    expect(codes(manifest, { title: 'Account' })).toEqual([]);
    expect(codes(manifest, { title: { en: 'Account', 'zh-CN': '客户' } })).toEqual([]);
  });

  it('still reports a value that matches NO arm — the union is not an opt-out', () => {
    // The control for fact 1. Every "accepts" assertion above would also pass if
    // the coarse check had stopped running altogether.
    expect(codes(manifest, { title: 42 })).toContain('type-mismatch');
    expect(codes(manifest, { title: true })).toContain('type-mismatch');
    expect(codes(manifest, { title: ['Account'] })).toContain('type-mismatch');
  });

  it('names every arm in the message, once, in declaration order', () => {
    expect(messages(manifest, { title: 42 })).toEqual([
      '<probe> prop "title" expected a string or an object',
    ]);
  });

  it('reports one diagnostic per prop, not one per failed arm', () => {
    expect(codes(manifest, { title: 42 })).toHaveLength(1);
  });

  it('reports at the STRICTEST arm severity when an enum arm is present', () => {
    // An enum's closed list is the one fact this layer is certain about, so
    // adding a second arm beside it must not turn its verdict into a dismissible
    // warning. The code becomes `type-mismatch` (the fact is "fits none of the
    // arms") while the message still carries the allowed values.
    const withEnum = one([{ name: 'size', type: ['number', 'enum'], enum: ['sm', 'lg'] }]);
    expect(codes(withEnum, { size: 12 })).toEqual([]);
    expect(codes(withEnum, { size: 'lg' })).toEqual([]);

    const bad = validateTree(
      { type: 'probe', size: 'enormous' } as SchemaElement,
      withEnum,
    ).diagnostics;
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ severity: 'error', code: 'type-mismatch' });
    expect(bad[0].message).toContain('one of ["sm","lg"]');
  });

  it('a `slot` arm keeps accepting everything', () => {
    // Preserves the pre-union `default: return null` branch: a slot describes a
    // child position, not a value, and those inputs never drew a diagnostic.
    const slotty = one([{ name: 'footer', type: 'slot' }]);
    expect(codes(slotty, { footer: 'anything' })).toEqual([]);
    expect(codes(slotty, { footer: { deeply: ['nested'] } })).toEqual([]);
  });
});

describe('a single-kind declaration is unchanged (backward compatibility)', () => {
  it('produces the same messages it always did', () => {
    const manifest = one([
      { name: 's', type: 'string' },
      { name: 'n', type: 'number' },
      { name: 'b', type: 'boolean' },
      { name: 'a', type: 'array' },
      { name: 'o', type: 'object' },
      { name: 'c', type: 'color' },
    ]);
    expect(messages(manifest, { s: 1 })).toEqual(['<probe> prop "s" expected a string']);
    expect(messages(manifest, { n: 'x' })).toEqual(['<probe> prop "n" expected a number']);
    expect(messages(manifest, { b: 'x' })).toEqual(['<probe> prop "b" expected a boolean']);
    expect(messages(manifest, { a: {} })).toEqual(['<probe> prop "a" expected an array']);
    expect(messages(manifest, { o: [] })).toEqual(['<probe> prop "o" expected an object']);
    // `color` is a string with a narrower control — its message was, and stays,
    // the string one.
    expect(messages(manifest, { c: 1 })).toEqual(['<probe> prop "c" expected a string']);
  });

  it('keeps `invalid-enum` at error severity for a lone enum arm', () => {
    // The one code that is NOT `type-mismatch`, and the severity a silent
    // fallback would hide behind (objectui#3985). A lone enum arm must keep both.
    const manifest = one([{ name: 'mode', type: 'enum', enum: ['a', 'b'] }]);
    const d = validateTree({ type: 'probe', mode: 'c' } as SchemaElement, manifest).diagnostics;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'error', code: 'invalid-enum' });
    expect(d[0].message).toBe('<probe> prop "mode"="c" is not one of ["a","b"]');
  });

  it('serializes to the bare string, so an existing manifest is byte-identical', () => {
    const before = one([{ name: 'title', type: 'string' }]);
    expect(before.components.probe.inputs[0].type).toBe('string');
    expect(JSON.stringify(before)).toContain('"type":"string"');
  });
});

describe('canonicalizeInputType — what reaches the published manifest', () => {
  it('collapses a one-element array to the bare kind', () => {
    // So a union declaration that happens to have one arm cannot fork the
    // published shape into two spellings of one meaning.
    expect(canonicalizeInputType(['string'])).toBe('string');
    expect(one([{ name: 'x', type: ['string'] }]).components.probe.inputs[0].type).toBe('string');
  });

  it('de-duplicates repeated arms', () => {
    expect(canonicalizeInputType(['string', 'string'])).toBe('string');
    expect(canonicalizeInputType(['string', 'object', 'string'])).toEqual(['string', 'object']);
  });

  it('preserves arm order for a real union', () => {
    expect(canonicalizeInputType(['object', 'string'])).toEqual(['object', 'string']);
  });

  it('coerces a lone off-vocabulary kind to `string`, as it always did', () => {
    expect(canonicalizeInputType('i18nString')).toBe('string');
    expect(canonicalizeInputType(undefined)).toBe('string');
  });

  it('DROPS an off-vocabulary arm from a union instead of coercing it', () => {
    // Coercing would publish a `'string'` arm the author never declared — a
    // widening invented by the serializer. The surviving arms carry the
    // declaration, so the unknown one is dropped.
    expect(canonicalizeInputType(['object', 'i18nString'])).toBe('object');
    expect(canonicalizeInputType(['number', 'nope', 'boolean'])).toEqual(['number', 'boolean']);
    // …and if that empties the array, the lone-unknown fallback applies, because
    // a manifest input must always carry a valid kind.
    expect(canonicalizeInputType(['nope', 'alsoNope'])).toBe('string');
    expect(canonicalizeInputType([])).toBe('string');
  });

  it('is what the gate reads — a dropped arm is not silently honoured', () => {
    const manifest = one([{ name: 'title', type: ['object', 'i18nString'] as never }]);
    expect(codes(manifest, { title: { en: 'x' } })).toEqual([]);
    expect(codes(manifest, { title: 'x' })).toContain('type-mismatch');
  });
});

describe('inputTypeArms', () => {
  it('normalizes both declaration forms', () => {
    expect(inputTypeArms('string')).toEqual(['string']);
    expect(inputTypeArms(['string', 'number'])).toEqual(['string', 'number']);
    expect(inputTypeArms(undefined)).toEqual([]);
  });
});

describe('generateDts emits the union it validates', () => {
  it('emits a TypeScript union for a multi-arm input', () => {
    const dts = generateDts(
      one([
        { name: 'title', type: ['string', 'object'], required: true },
        { name: 'defaultValue', type: ['string', 'number'] },
      ]),
    );
    expect(dts).toContain('title: string | Record<string, unknown>;');
    expect(dts).toContain('defaultValue?: string | number;');
  });

  it('de-duplicates arms that collapse to the same TS type', () => {
    const dts = generateDts(one([{ name: 'tint', type: ['string', 'color'] }]));
    expect(dts).toContain('tint?: string;');
    expect(dts).not.toContain('string | string');
  });

  it('emits an enum arm as its literal union, beside the other arms', () => {
    const dts = generateDts(one([{ name: 'size', type: ['enum', 'number'], enum: ['sm', 'lg'] }]));
    expect(dts).toContain('size?: "sm" | "lg" | number;');
  });

  it('omits an input whose only arm is a slot, and keeps one that has a value arm', () => {
    const dts = generateDts(
      one([
        { name: 'footer', type: 'slot' },
        { name: 'caption', type: ['slot', 'string'] },
      ]),
    );
    expect(dts).not.toContain('footer');
    // The old test was `i.type !== 'slot'`, which this union passes; the type is
    // taken from the value arms only, so the slot arm contributes nothing.
    expect(dts).toContain('caption?: string;');
  });
});

describe('the union survives the whole compile pipeline', () => {
  it('compiles a JSX page that writes either arm', () => {
    const manifest = one([{ name: 'title', type: ['string', 'object'] }]);
    expect(compile(`<probe title="Account" />`, manifest).diagnostics).toEqual([]);
    expect(
      compile(`<probe title={{ "en": "Account", "zh-CN": "客户" }} />`, manifest).diagnostics,
    ).toEqual([]);
    expect(compile(`<probe title={42} />`, manifest).diagnostics.map((d) => d.code)).toContain(
      'type-mismatch',
    );
  });
});
