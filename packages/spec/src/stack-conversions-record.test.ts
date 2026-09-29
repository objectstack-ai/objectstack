// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The conversion record beside the stack provenance mark — `stackConversionsOf`
 * (`stack-provenance.ts`).
 *
 * `defineStack` applies every ADR-0087 D2 conversion at load, in both modes,
 * so the stack it returns is already canonical and a door re-running the pass
 * on it converts nothing. What the doors report under `conversions` (and what
 * `os validate --strict` gates on) therefore has to come from the producer, as
 * a record on the value it returns. What is pinned here:
 *
 *  - `defineStack` (strict and `strict: false`) records each conversion it
 *    applied, whole, as the `ConversionNotice` the conversion layer emitted —
 *    and records nothing for the canonical spelling (the control, on a stack
 *    that IS marked, so `[]` is not the unmarked answer);
 *  - the record is not subject to the stderr warn-once: a second build of the
 *    same source carries it too;
 *  - it is invisible to every data reader (keys, JSON, the strict schema) and
 *    frozen;
 *  - it is dropped exactly where the mark is dropped, and a forged record on
 *    an unmarked value is not read;
 *  - `composeStacks`: the inputs' records concatenated in input order, one
 *    application once, at every arity and through nesting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  composeStacks,
  defineStack,
  hasStackProvenance,
  stackConversionsOf,
  ObjectStackDefinitionSchema,
  type ObjectStackDefinition,
} from './stack.zod';
import { CONVERSION_NOTICE_CODE, type ConversionNotice } from './conversions/types';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A stack with one `page:header` component whose second line is authored
 * under `headerKey` — `description` is the alias the live conversion
 * `page-header-subtitle-alias` rewrites to `subtitle`; `subtitle` is canonical.
 * No standalone actions, so the same built stack can be composed twice.
 */
const source = (ns: string, headerKey: 'description' | 'subtitle', pageKind: 'jsx' | 'html' = 'html') => ({
  manifest: { id: `com.example.${ns}`, name: ns, version: '1.0.0', type: 'app' as const, namespace: ns },
  objects: [{ name: `${ns}_thing`, label: 'Thing', fields: { title: { type: 'text' as const, label: 'Title' } } }],
  pages: [
    {
      name: `${ns}_home`,
      label: 'Home',
      regions: [
        {
          name: 'main',
          components: [{ type: 'page:header', properties: { title: 'Things', [headerKey]: 'All things' } }],
        },
      ],
    },
    ...(pageKind === 'jsx' ? [{ name: `${ns}_landing`, label: 'Landing', kind: 'jsx', source: '<div>hi</div>' }] : []),
  ],
});

const HEADER_PATH = 'pages[0].regions[0].components[0].properties.subtitle';

/** The substance a door publishes per entry: identity, site, direction, expiry. */
const substance = (n: ConversionNotice) => ({
  code: n.code,
  conversionId: n.conversionId,
  path: n.path,
  from: n.from,
  to: n.to,
  retiresIn: n.retiresIn,
});

const HEADER_NOTICE = {
  code: CONVERSION_NOTICE_CODE,
  conversionId: 'page-header-subtitle-alias',
  path: HEADER_PATH,
  from: 'description',
  to: 'subtitle',
  retiresIn: 18,
};

const KIND_NOTICE = {
  code: CONVERSION_NOTICE_CODE,
  conversionId: 'page-kind-jsx-to-html',
  path: 'pages[1].kind',
  from: 'jsx',
  to: 'html',
};

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('defineStack records the conversions it applied', () => {
  it('strict: the one conversion, whole, as the conversion layer emitted it', () => {
    quiet();
    const built = defineStack(source('aa', 'description') as never);
    const record = stackConversionsOf(built);
    expect(record.map(substance)).toEqual([HEADER_NOTICE]);
    // The element IS the `ConversionNotice` the doors' `conversions` field
    // declares — every field, not a second shape.
    expect(Object.keys(record[0]).sort()).toEqual(
      ['code', 'conversionId', 'from', 'message', 'path', 'retiresIn', 'surface', 'to', 'toMajor'].sort(),
    );
    // …and the stack itself IS canonical: the record is of what was done to it.
    const header = (built.pages as Array<{ regions: Array<{ components: Array<{ properties: Record<string, unknown> }> }> }>)[0]
      .regions[0].components[0].properties;
    expect(header.subtitle).toBe('All things');
    expect('description' in header).toBe(false);
  });

  it('strict: false records it too — the conversion runs in both modes', () => {
    quiet();
    const built = defineStack(source('aa', 'description') as never, { strict: false });
    expect(stackConversionsOf(built).map(substance)).toEqual([HEADER_NOTICE]);
  });

  it('two conversions in one source are recorded in the order they were applied', () => {
    quiet();
    const built = defineStack(source('aa', 'description', 'jsx') as never, { strict: false });
    const record = stackConversionsOf(built).map(substance);
    expect(record).toHaveLength(2);
    expect(record).toContainEqual(HEADER_NOTICE);
    expect(record).toContainEqual(expect.objectContaining(KIND_NOTICE));
  });

  it('⭐ control: the canonical spelling records nothing, on a stack that IS marked', () => {
    const warn = quiet();
    for (const built of [
      defineStack(source('aa', 'subtitle') as never),
      defineStack(source('aa', 'subtitle') as never, { strict: false }),
    ]) {
      expect(hasStackProvenance(built), '`[]` here must not be the unmarked answer').toBe(true);
      expect(stackConversionsOf(built)).toEqual([]);
    }
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("conversion 'page-header-subtitle-alias'"));
  });

  it('is not subject to the stderr warn-once: a second build of the same source carries the record too', () => {
    const warn = quiet();
    const ns = 'warnonce';
    const first = defineStack(source(ns, 'description') as never);
    const second = defineStack(source(ns, 'description') as never);
    const lines = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("conversion 'page-header-subtitle-alias'") && l.includes(HEADER_PATH));
    // stderr says it at most once per process (an earlier test may have said it already)…
    expect(lines.length).toBeLessThanOrEqual(1);
    // …while each built stack keeps its own record.
    expect(stackConversionsOf(first).map(substance)).toEqual([HEADER_NOTICE]);
    expect(stackConversionsOf(second).map(substance)).toEqual([HEADER_NOTICE]);
  });

  it('a built stack handed straight back to defineStack keeps the record it was built with', () => {
    quiet();
    const inner = defineStack(source('aa', 'description') as never, { strict: false });
    const outer = defineStack(inner as never, { strict: false });
    expect(outer).not.toBe(inner);
    expect(stackConversionsOf(outer).map(substance)).toEqual([HEADER_NOTICE]);
  });
});

describe('the record is invisible to every data reader, and frozen', () => {
  const built = () => {
    quiet();
    return defineStack(source('aa', 'description') as never);
  };

  it('is not an own string key and is non-enumerable, non-writable, non-configurable', () => {
    const stack = built();
    const sym = Symbol.for('objectstack.stack.conversions');
    expect(Object.keys(stack).some((k) => k.includes('conversion'))).toBe(false);
    const desc = Object.getOwnPropertyDescriptor(stack, sym);
    expect(desc?.enumerable).toBe(false);
    expect(desc?.writable).toBe(false);
    expect(desc?.configurable).toBe(false);
  });

  it('is frozen, entries included', () => {
    const record = stackConversionsOf(built());
    expect(record, 'anti-vacuity: an empty record is frozen by construction').toHaveLength(1);
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.every((n) => Object.isFrozen(n))).toBe(true);
    expect(() => (record as ConversionNotice[]).push(record[0])).toThrow(TypeError);
  });

  it('never reaches JSON, and the strict stack schema neither sees nor refuses it', () => {
    const stack = built();
    expect(stackConversionsOf(stack), 'anti-vacuity: there IS a record to leak').toHaveLength(1);
    expect(JSON.stringify(stack)).not.toContain('page-header-subtitle-alias');
    expect(ObjectStackDefinitionSchema.safeParse(stack).success).toBe(true);
  });
});

describe('stackConversionsOf answers [] wherever the mark is absent', () => {
  const built = () => {
    quiet();
    return defineStack(source('aa', 'description') as never);
  };

  it('a plain literal, a spread copy and a JSON copy of a built stack', () => {
    const stack = built();
    expect(stackConversionsOf(source('aa', 'description'))).toEqual([]);
    expect(stackConversionsOf({ ...stack })).toEqual([]);
    expect(stackConversionsOf(JSON.parse(JSON.stringify(stack)))).toEqual([]);
    // positive control for the three: the built stack itself
    expect(stackConversionsOf(stack)).toHaveLength(1);
  });

  it('a forged record on an unmarked value is not read', () => {
    const stack = built();
    const forged: Record<symbol, unknown> = {};
    const genuine = stackConversionsOf(stack);
    expect(genuine, 'anti-vacuity: the forged record is a non-empty one').toHaveLength(1);
    Object.defineProperty(forged, Symbol.for('objectstack.stack.conversions'), {
      value: genuine,
      enumerable: false,
    });
    expect(hasStackProvenance(forged)).toBe(false);
    expect(stackConversionsOf(forged)).toEqual([]);
  });

  it('non-objects', () => {
    for (const v of [null, undefined, 0, 'x', true]) expect(stackConversionsOf(v)).toEqual([]);
  });
});

describe('composeStacks records its inputs’ records, in input order, one application once', () => {
  const build = (ns: string, headerKey: 'description' | 'subtitle') => {
    quiet();
    return defineStack(source(ns, headerKey) as never, { strict: false });
  };

  it('two inputs: concatenated in input order, each path relative to its own defineStack call', () => {
    const a = build('aa', 'description');
    const b = build('bb', 'subtitle');
    const c = build('cc', 'description');
    const composed = composeStacks([a, b, c] as ObjectStackDefinition[]);
    const record = stackConversionsOf(composed);
    expect(record).toEqual([...stackConversionsOf(a), ...stackConversionsOf(c)]);
    expect(record.map(substance)).toEqual([HEADER_NOTICE, HEADER_NOTICE]);
    // Reversing the inputs reverses the record: order is the INPUT order.
    const reversed = stackConversionsOf(composeStacks([c, b, a] as ObjectStackDefinition[]));
    expect(reversed[0]).toBe(stackConversionsOf(c)[0]);
    expect(reversed[1]).toBe(stackConversionsOf(a)[0]);
  });

  it('the same built stack passed twice is one application, counted once', () => {
    const a = build('aa', 'description');
    const composed = composeStacks([a, a] as ObjectStackDefinition[], { objectConflict: 'override' });
    expect(stackConversionsOf(composed).map(substance)).toEqual([HEADER_NOTICE]);
  });

  it('every arity, the preserve manifest and nesting', () => {
    const a = build('aa', 'description');
    const b = build('bb', 'subtitle');
    const c = build('cc', 'description');
    expect(stackConversionsOf(a), 'anti-vacuity: the inputs carry records').toHaveLength(1);
    expect(stackConversionsOf(c)).toHaveLength(1);
    expect(stackConversionsOf(composeStacks([]))).toEqual([]);
    // a single input is returned as-is, record included
    expect(composeStacks([a] as ObjectStackDefinition[])).toBe(a);
    expect(stackConversionsOf(composeStacks([a] as ObjectStackDefinition[]))).toBe(stackConversionsOf(a));
    expect(
      stackConversionsOf(composeStacks([a, b] as ObjectStackDefinition[], { manifest: 'preserve' })),
    ).toEqual(stackConversionsOf(a));
    const nested = composeStacks([composeStacks([a, b] as ObjectStackDefinition[]), c] as ObjectStackDefinition[]);
    expect(stackConversionsOf(nested)).toEqual([...stackConversionsOf(a), ...stackConversionsOf(c)]);
  });

  it('⭐ control: inputs that converted nothing compose to an empty record on a marked artifact', () => {
    const composed = composeStacks([build('aa', 'subtitle'), build('bb', 'subtitle')] as ObjectStackDefinition[]);
    expect(hasStackProvenance(composed)).toBe(true);
    expect(stackConversionsOf(composed)).toEqual([]);
  });
});
