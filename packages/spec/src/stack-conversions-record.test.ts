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
 *    application once, at every arity and through nesting;
 *  - a producer that REFUSES carries the record on its ADR-0112 refusal, as it
 *    stood at the throw: every `defineStack` refusal site (both modes), the
 *    `composeStacks` refusals (its inputs' records), the empty record when
 *    nothing was converted, and B's own notice when a refusing
 *    `defineStack(B)` inside `composeStacks([...])` had its stderr line
 *    swallowed by the warn-once. A non-refusal throw carries none.
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

/** The thrown value (the test fails when nothing is thrown). */
function thrown(run: () => unknown): Error & { code?: string; status?: number; issues?: readonly unknown[] } {
  try {
    run();
  } catch (error) {
    return error as Error & { code?: string; status?: number; issues?: readonly unknown[] };
  }
  throw new Error('expected a refusal, but the call returned');
}

/** The record property as the stamp left it, or `undefined` when there is none. */
const ownRecord = (value: object) => Object.getOwnPropertyDescriptor(value, Symbol.for('objectstack.stack.conversions'));

describe('a refusing producer carries the conversions it applied on its refusal', () => {
  it("⭐ triage pin: a convert-then-refuse call's error answers page-header-subtitle-alias", () => {
    quiet();
    const error = thrown(() =>
      defineStack({ ...source('rf', 'description'), requires: ['no-such-capability'] } as never),
    );
    expect(error.code).toBe('STACK_CAPABILITY_UNKNOWN');
    expect(error.status).toBe(422);
    const record = stackConversionsOf(error);
    expect(record.map(substance)).toEqual([HEADER_NOTICE]);
    // The element is the whole `ConversionNotice`, the same shape a built stack carries.
    expect(Object.keys(record[0]).sort()).toEqual(
      ['code', 'conversionId', 'from', 'message', 'path', 'retiresIn', 'surface', 'to', 'toMajor'].sort(),
    );
    // An error is not a built stack: the record rides without the mark.
    expect(hasStackProvenance(error)).toBe(false);
  });

  it('⭐ triage pin: a refusal with no conversion answers an empty record — stamped, not merely absent', () => {
    quiet();
    const error = thrown(() =>
      defineStack({ ...source('rf', 'subtitle'), requires: ['no-such-capability'] } as never),
    );
    expect(error.code).toBe('STACK_CAPABILITY_UNKNOWN');
    expect(stackConversionsOf(error)).toEqual([]);
    // Anti-vacuity: `[]` is the refusal's own (empty) record, so the guard
    // covered this throw — an unstamped error answers `[]` too.
    const desc = ownRecord(error);
    expect(desc, 'the refusal carries the record property').toBeDefined();
    expect(desc?.value).toEqual([]);
    expect(Object.isFrozen(desc?.value)).toBe(true);
  });

  it('the refusal is otherwise the same refusal: code, status, name, message and issues are unchanged', () => {
    quiet();
    const converting = thrown(() =>
      defineStack({ ...source('rf', 'description'), requires: ['no-such-capability'] } as never),
    );
    const canonical = thrown(() =>
      defineStack({ ...source('rf', 'subtitle'), requires: ['no-such-capability'] } as never),
    );
    for (const key of ['code', 'status', 'name', 'message'] as const) {
      expect(converting[key], key).toBe(canonical[key]);
    }
    expect(converting.issues).toEqual(canonical.issues);
    expect(converting.message).toMatch(/^defineStack capability validation failed \(1 issue\):/);
  });

  it('the record on a refusal is invisible to data readers and frozen, like the one on a stack', () => {
    quiet();
    const error = thrown(() =>
      defineStack({ ...source('rf', 'description'), requires: ['no-such-capability'] } as never),
    );
    const desc = ownRecord(error);
    expect(desc?.enumerable).toBe(false);
    expect(desc?.writable).toBe(false);
    expect(desc?.configurable).toBe(false);
    expect(Object.keys(error).some((k) => k.includes('conversion'))).toBe(false);
    const record = stackConversionsOf(error);
    expect(record, 'anti-vacuity: there is a record to freeze').toHaveLength(1);
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.every((n) => Object.isFrozen(n))).toBe(true);
  });

  it('the record is what was applied so far: a built stack handed straight back and then refused keeps the record it arrived with', () => {
    quiet();
    // Built without validation, so the capability refusal is still owed.
    const inner = defineStack(
      { ...source('rf', 'description'), requires: ['no-such-capability'] } as never,
      { strict: false },
    );
    expect(stackConversionsOf(inner), 'anti-vacuity: the inner build recorded one').toHaveLength(1);
    // Handed straight back, strict: the pass finds nothing left to convert,
    // and the refusal carries the record the input arrived with.
    const error = thrown(() => defineStack(inner as never));
    expect(error.code).toBe('STACK_CAPABILITY_UNKNOWN');
    expect(stackConversionsOf(error)).toEqual(stackConversionsOf(inner));
    // Control: a spread copy drops the record with the mark, and its source is
    // already canonical — so this call applied nothing, and says so. The
    // record is the producer's, never reconstructed.
    const copied = thrown(() => defineStack({ ...inner } as never));
    expect(copied.code).toBe('STACK_CAPABILITY_UNKNOWN');
    expect(stackConversionsOf(copied)).toEqual([]);
  });

  it("⭐ triage pin: in composeStacks([defineStack(A), defineStack(B)]) the refusing B's error carries B's own notice, though its stderr line was swallowed", () => {
    const warn = quiet();
    const printed: string[][] = [];
    const built: unknown[] = [];
    /** `defineStack`, recording the stderr lines THIS call printed. */
    const define = (config: unknown) => {
      const start = warn.mock.calls.length;
      try {
        const stack = defineStack(config as never);
        built.push(stack);
        return stack;
      } finally {
        printed.push(warn.mock.calls.slice(start).map((c) => String(c[0])));
      }
    };
    const headerLines = (lines: string[]) =>
      lines.filter((l) => l.includes("conversion 'page-header-subtitle-alias'") && l.includes(HEADER_PATH));

    // A and B author the same notice path, so their warn-once key is one key.
    const error = thrown(() =>
      composeStacks([
        define(source('ca', 'description')),
        define({ ...source('cb', 'description'), requires: ['no-such-capability'] }),
      ] as ObjectStackDefinition[]),
    );

    // Where it surfaces: B's own `defineStack` refusal, thrown while the array
    // was being built — `composeStacks` never ran.
    expect(error.code).toBe('STACK_CAPABILITY_UNKNOWN');
    expect(error.message).toMatch(/^defineStack capability validation failed/);
    expect(built, 'only A was built').toHaveLength(1);
    expect(printed).toHaveLength(2);
    // B printed nothing: the warn-once set had the key already (from A, or
    // from an earlier build of the same path in this process).
    expect(headerLines(printed[1])).toEqual([]);
    // …and its refusal still carries B's own notice — exactly one, and not A's object.
    const record = stackConversionsOf(error);
    expect(record.map(substance)).toEqual([HEADER_NOTICE]);
    const aRecord = stackConversionsOf(built[0]);
    expect(aRecord, 'anti-vacuity: A recorded the same notice').toHaveLength(1);
    expect(record[0]).not.toBe(aRecord[0]);
  });
});

describe('every refusal site in defineStack carries the record — census, both modes', () => {
  const manifest = {
    id: 'com.example.refusalrecord',
    name: 'refusal-record-test',
    version: '1.0.0',
    type: 'app' as const,
    namespace: 'probe',
  };
  const task = { name: 'probe_task', label: 'Task', fields: { title: { type: 'text' as const, label: 'Title' } } };
  const app = (name: string) => ({
    name,
    label: name,
    navigation: [{ id: `nav_${name}`, type: 'object' as const, label: 'Tasks', objectName: task.name }],
  });
  const recordFlow = {
    name: 'task_fanout',
    label: 'task_fanout',
    type: 'record_change',
    nodes: [
      { id: 'start', type: 'start', label: 'start', config: { objectName: task.name, triggerType: 'record-after-create' } },
      { id: 'end', type: 'end', label: 'end' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };
  /** The converting page every row carries: `description` on a `page:header`. */
  const pages = source('probe', 'description').pages;
  const grant = { name: 'managers', label: 'Managers', objects: { [task.name]: { allowRead: true, readScope: 'unit_and_below' } } };

  const rows: Array<{ site: string; code: string; config: Record<string, unknown>; strict?: false }> = [
    { site: 'schema parse', code: 'STACK_SCHEMA_INVALID', config: { manifest: {}, pages } },
    { site: 'capability', code: 'STACK_CAPABILITY_UNKNOWN', config: { manifest, objects: [task], pages, requires: ['automations'] } },
    {
      site: 'cross-reference',
      code: 'STACK_CROSS_REFERENCE_INVALID',
      config: { manifest, objects: [task], pages, data: [{ object: 'missing_object', records: [] }] },
    },
    { site: 'namespace prefix', code: 'STACK_NAMESPACE_PREFIX_INVALID', config: { manifest, objects: [{ ...task, name: 'task' }], pages } },
    { site: 'single app', code: 'STACK_SINGLE_APP_VIOLATION', config: { manifest, objects: [task], pages, apps: [app('app_one'), app('app_two')] } },
    { site: 'hierarchy-scope capability', code: 'STACK_HIERARCHY_SCOPE_CAPABILITY_REQUIRED', config: { manifest, objects: [task], pages, permissions: [grant] } },
    {
      site: 'trigger capability',
      code: 'STACK_TRIGGER_CAPABILITY_REQUIRED',
      config: { manifest, objects: [task], pages, requires: ['automation'], flows: [recordFlow] },
    },
    { site: 'bound-action merge, strict: false — objects not an array', code: 'STACK_SCHEMA_INVALID', config: { manifest, objects: 'nope', pages }, strict: false },
    { site: 'bound-action merge, strict: false — an objects entry not an object', code: 'STACK_SCHEMA_INVALID', config: { manifest, objects: [null], pages }, strict: false },
    { site: 'bound-action merge, strict: false — actions not an array', code: 'STACK_SCHEMA_INVALID', config: { manifest, objects: [task], actions: 7, pages }, strict: false },
  ];

  for (const row of rows) {
    it(`${row.site}: ${row.code} carries the header notice`, () => {
      quiet();
      const error = thrown(() => defineStack(row.config as never, row.strict === false ? { strict: false } : undefined));
      expect(error.code).toBe(row.code);
      expect(error.status).toBe(422);
      expect(stackConversionsOf(error).map(substance)).toEqual([HEADER_NOTICE]);
    });
  }

  it('the census reaches every code defineStack refuses with: seven distinct codes', () => {
    expect(new Set(rows.map((r) => r.code)).size).toBe(7);
  });
});

describe('a composeStacks refusal carries its inputs’ records', () => {
  const build = (ns: string, headerKey: 'description' | 'subtitle', objectNs = ns) => {
    quiet();
    const stack = source(ns, headerKey);
    return defineStack(
      { ...stack, objects: [{ ...stack.objects[0], name: `${objectNs}_thing` }] } as never,
      { strict: false },
    );
  };

  it('an object conflict: the inputs’ records, in input order — the record the artifact would have carried', () => {
    const a = build('ka', 'description', 'kk');
    const b = build('kb', 'subtitle', 'kk');
    const c = build('kc', 'description', 'kk');
    const error = thrown(() => composeStacks([a, b, c] as ObjectStackDefinition[]));
    expect(error.code).toBe('STACK_COMPOSE_OBJECT_CONFLICT');
    expect(error.status).toBe(422);
    expect(stackConversionsOf(error)).toEqual([...stackConversionsOf(a), ...stackConversionsOf(c)]);
    expect(stackConversionsOf(error).map(substance)).toEqual([HEADER_NOTICE, HEADER_NOTICE]);
  });

  it('an unbuilt input: the built inputs’ records ride the provenance refusal', () => {
    const a = build('pa', 'description');
    const error = thrown(() => composeStacks([a, { ...a }] as ObjectStackDefinition[]));
    expect(error.code).toBe('STACK_PROVENANCE_MISSING');
    expect(stackConversionsOf(error)).toEqual(stackConversionsOf(a));
    expect(stackConversionsOf(error), 'anti-vacuity').toHaveLength(1);
  });

  it('⭐ control: inputs that converted nothing refuse with an empty record — stamped', () => {
    const error = thrown(() =>
      composeStacks([build('za', 'subtitle', 'zz'), build('zb', 'subtitle', 'zz')] as ObjectStackDefinition[]),
    );
    expect(error.code).toBe('STACK_COMPOSE_OBJECT_CONFLICT');
    expect(stackConversionsOf(error)).toEqual([]);
    expect(ownRecord(error)?.value).toEqual([]);
  });

  it('a non-refusal throw is not given a record: the options parse error carries none', () => {
    const a = build('oa', 'description');
    const b = build('ob', 'subtitle');
    const error = thrown(() =>
      composeStacks([a, b] as ObjectStackDefinition[], { objectConflict: 'nope' } as never),
    );
    expect(error.code, 'not an ADR-0112 refusal').toBeUndefined();
    expect(ownRecord(error)).toBeUndefined();
    expect(stackConversionsOf(error)).toEqual([]);
  });
});

describe('stackConversionsOf reads a refusal’s record and nothing that merely looks like one', () => {
  it('an Error nobody stamped answers []', () => {
    expect(stackConversionsOf(new Error('x'))).toEqual([]);
  });

  it('a record inherited through the prototype, not stamped on the error itself, is not read', () => {
    quiet();
    const refusal = thrown(() =>
      defineStack({ ...source('rf', 'description'), requires: ['no-such-capability'] } as never),
    );
    expect(stackConversionsOf(refusal), 'anti-vacuity: the stamped refusal is read').toHaveLength(1);
    const heir = Object.create(refusal) as Error;
    expect(heir).toBeInstanceOf(Error);
    expect(stackConversionsOf(heir)).toEqual([]);
  });
});
