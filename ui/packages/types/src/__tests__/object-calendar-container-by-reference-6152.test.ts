/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 9 — the `object-calendar` ELEMENT's own `calendar` container
 * follows `@objectstack/spec` 17.7.0's slot BY REFERENCE, and its `.passthrough()` is gone.
 *
 * 17.7.0 types `ComponentPropsMap['object-calendar'].calendar` (objectstack#21464 stage 2)
 * as a strict copy of the list view's calendar block. This package kept the container as
 * `CalendarConfigSchema` `.partial()` + `.passthrough()`, so its door admitted two things
 * the slot refuses: an unexamined key (`calendar.defaultView`, a misspelling), and a block
 * without `startDateField`. objectui#8327 forbids that direction. The container is now the
 * row's own member, extended only by objectui#8355's two by-name alias refusals.
 *
 * The blocks below:
 *
 *   1. the slot, measured on the INSTALLED spec — its wrapper chain, its strictness, its
 *      members, the required `startDateField`, and that it declares no `defaultView`;
 *   2. the mirror IS that slot (member identity, not a copy);
 *   3. verdict equality: on every input below, the mirror's container gives the slot's
 *      verdict and the slot's diagnostics, except the two aliases, which both refuse and
 *      objectui names at their own path;
 *   4. both directions through the published doors, on the element: an unknown key,
 *      `defaultView` and the aliases are refused; the five declared members still parse;
 *   5. the TypeScript face, which derives from the mirror and is closed the same way;
 *   6. the corpus census: every authored `object-calendar` container in this repository
 *      parses on the narrowed door. The population is re-derived on every run, so no count
 *      is written down here (AGENTS.md #9).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

import {
  CalendarConfigSchema,
  ObjectCalendarPropsSchema as SpecObjectCalendarPropsSchema,
} from '@objectstack/spec/ui';
import type { ObjectCalendarProps as SpecObjectCalendarProps } from '@objectstack/spec/ui';
import type { ObjectCalendarBlockConfig, ObjectCalendarSchema as TsObjectCalendarSchema } from '../objectql';
import { ObjectCalendarSchema } from '../zod/objectql.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

/* ── Instruments ─────────────────────────────────────────────────────────────── */

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };
type Parse = (doc: unknown) => Parsed;
type Zod = {
  safeParse: Parse;
  unwrap: () => Zod;
  shape: Record<string, Zod>;
  _zod: { def: { type: string; innerType?: Zod; catchall?: Zod } };
};

const issues = (r: Parsed) =>
  r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message, keys: i.keys }));
const codeAndPath = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path })));

/** `['optional', 'object']` and the like: the def types from the outside in. */
function wrapperChain(schema: Zod): string[] {
  const chain: string[] = [];
  let cur: Zod | undefined = schema;
  while (cur) {
    chain.push(cur._zod.def.type);
    cur = cur._zod.def.innerType;
  }
  return chain;
}
const catchallOf = (object: Zod) => object._zod.def.catchall?._zod.def.type;

const ROW = SpecObjectCalendarPropsSchema as unknown as Zod;
/** The installed slot, as the row holds it: `optional` around the strict block. */
const SLOT = ROW.shape.calendar;
const SLOT_BLOCK = SLOT.unwrap();
/** This package's member, as `ObjectCalendarSchema` holds it. */
const MIRROR = (ObjectCalendarSchema as unknown as Zod).shape.calendar;
const MIRROR_BLOCK = MIRROR.unwrap();
const SPEC_BLOCK = CalendarConfigSchema as unknown as Zod;

const ALIASES = [['dateField', 'startDateField'], ['endField', 'endDateField']] as const;
const CONTROL_KEY = 'zzqxNoSuchField';
const FIVE = {
  startDateField: 'starts_at',
  endDateField: 'ends_at',
  titleField: 'subject',
  colorField: 'status_color',
  allDayField: 'is_all_day',
};
const NODE = { type: 'object-calendar', objectName: 'event' };

const DOORS: ReadonlyArray<readonly [string, Parse]> = [
  ['the element mirror', (d) => ObjectCalendarSchema.safeParse(d)],
  ['the tolerant face', (d) => AnyComponentSchema.safeParse(d)],
  ['the strict face', (d) => StrictAnyComponentSchema.safeParse(d)],
  ['safeValidateSchema', (d) => safeValidateSchema(d)],
];

/* ── 1. The slot, on the installed protocol (the precondition) ───────────────── */

describe('objectui#6152 round 9 — the installed `object-calendar` `calendar` slot', () => {
  it('is `optional` around a STRICT object', () => {
    expect(wrapperChain(SLOT)).toEqual(['optional', 'object']);
    expect(catchallOf(SLOT_BLOCK)).toBe('never');
    // CONTROL — the same reading answers differently on an object that is still open: the
    // `object-calendar` NODE itself, whose `BaseSchema` envelope is `.passthrough()`. (This
    // control used to read the list VIEW's calendar block, which objectui#6152 round 11
    // closed: it is the spec's list-view slot by reference now.)
    expect(catchallOf(ObjectCalendarSchema as unknown as Zod)).toBe('unknown');
  });

  it('is a copy of the list view\'s block: not the same object, the same member objects', () => {
    expect(SLOT_BLOCK).not.toBe(SPEC_BLOCK);
    expect(Object.keys(SLOT_BLOCK.shape).sort()).toEqual(Object.keys(SPEC_BLOCK.shape).sort());
    for (const key of Object.keys(SLOT_BLOCK.shape)) expect(SLOT_BLOCK.shape[key]).toBe(SPEC_BLOCK.shape[key]);
  });

  it('requires `startDateField` (control: the start binding alone parses)', () => {
    expect(codeAndPath(SLOT_BLOCK.safeParse({ titleField: 'subject' })))
      .toEqual([{ code: 'invalid_type', path: ['startDateField'] }]);
    expect(SLOT_BLOCK.safeParse({ startDateField: 'starts_at' }).success).toBe(true);
  });

  it('declares no `defaultView` — the ROW declares it flat (H2)', () => {
    expect(Object.keys(SLOT_BLOCK.shape)).not.toContain('defaultView');
    expect(Object.keys(ROW.shape)).toContain('defaultView');
  });
});

/* ── 2. The mirror IS the slot ──────────────────────────────────────────────── */

describe('objectui#6152 round 9 — the mirror\'s container is the row\'s own member, by reference', () => {
  it('every slot member is the mirror\'s member (identity, not a copy)', () => {
    for (const key of Object.keys(SLOT_BLOCK.shape)) expect(MIRROR_BLOCK.shape[key]).toBe(SLOT_BLOCK.shape[key]);
    // CONTROL — the identity check can fail: the flat `startDateField` member is not the slot's.
    expect((ObjectCalendarSchema as unknown as Zod).shape.startDateField).not.toBe(SLOT_BLOCK.shape.startDateField);
  });

  it('adds nothing but the two alias refusals, and stays strict', () => {
    expect(Object.keys(MIRROR_BLOCK.shape).sort())
      .toEqual([...Object.keys(SLOT_BLOCK.shape), ...ALIASES.map(([alias]) => alias)].sort());
    expect(catchallOf(MIRROR_BLOCK)).toBe('never');
    expect(wrapperChain(MIRROR)).toEqual(['optional', 'object']);
  });
});

/* ── 3. Verdict equality ────────────────────────────────────────────────────── */

const INPUTS: ReadonlyArray<readonly [string, unknown]> = [
  ['an absent container', undefined],
  ['the start binding alone', { startDateField: 'starts_at' }],
  ['all five declared members', FIVE],
  ['an empty block', {}],
  ['a block without `startDateField`', { titleField: 'subject' }],
  ['`defaultView` inside the block', { startDateField: 'starts_at', defaultView: 'week' }],
  ['a misspelling of the start binding', { startDate: 'starts_at' }],
  ['an unknown key beside a valid block', { startDateField: 'starts_at', [CONTROL_KEY]: 'x' }],
  ['a wrong-typed required member', { startDateField: 42 }],
  ['a wrong-typed optional member', { startDateField: 'starts_at', allDayField: true }],
  ['a number', 42],
  ['null', null],
  ['a string', 'starts_at'],
  ['an array', []],
];

describe('objectui#6152 round 9 — the container\'s verdict is the slot\'s', () => {
  it.each(INPUTS)('%s: the same verdict and the same diagnostics', (_label, value) => {
    expect(issues(MIRROR.safeParse(value))).toEqual(issues(SLOT.safeParse(value)));
  });

  it('both verdicts occur, so the agreement above is a reading', () => {
    const verdicts = INPUTS.map(([, value]) => SLOT.safeParse(value).success);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it.each(ALIASES)('`%s`: both refuse; objectui names it at its own path, pointing at `%s`', (alias, canonical) => {
    const value = { startDateField: 'starts_at', [alias]: 'kickoff' };
    const upstream = SLOT.safeParse(value);
    expect(codeAndPath(upstream)).toEqual([{ code: 'unrecognized_keys', path: [] }]);
    expect(upstream.error!.issues[0].keys).toEqual([alias]);
    const local = MIRROR.safeParse(value);
    expect(codeAndPath(local)).toEqual([{ code: 'invalid_type', path: [alias] }]);
    expect(local.error!.issues[0].message).toContain(`Did you mean \`${alias}\` → \`${canonical}\`?`);
  });

  it('an alias in a block that also lacks `startDateField`: the missing binding is reported as the slot reports it', () => {
    const value = { dateField: 'kickoff' };
    const without = (r: Parsed, drop: (i: Issue) => boolean) => issues(r).filter((i) => !drop(i as Issue));
    expect(without(MIRROR.safeParse(value), (i) => i.path[0] === 'dateField'))
      .toEqual(without(SLOT.safeParse(value), (i) => i.code === 'unrecognized_keys'));
  });
});

/* ── 4. Both directions, through the doors ──────────────────────────────────── */

describe('objectui#6152 round 9 — on the element, through every published door', () => {
  describe.each(DOORS)('%s', (_door, parse) => {
    it('CONTROL: the five declared members parse', () => {
      const r = parse({ ...NODE, calendar: FIVE });
      expect(r.success, JSON.stringify(codeAndPath(r))).toBe(true);
    });

    it.each([CONTROL_KEY, 'defaultView'])('`calendar.%s` is refused, with the slot\'s `unrecognized_keys`', (key) => {
      const r = parse({ ...NODE, calendar: { startDateField: 'starts_at', [key]: 'week' } });
      expect(codeAndPath(r)).toEqual([{ code: 'unrecognized_keys', path: ['calendar'] }]);
      expect(r.error!.issues[0].keys).toEqual([key]);
    });

    it('a block without `startDateField` is refused at `calendar.startDateField`', () => {
      expect(codeAndPath(parse({ ...NODE, calendar: { titleField: 'subject' } })))
        .toEqual([{ code: 'invalid_type', path: ['calendar', 'startDateField'] }]);
    });

    it.each(ALIASES)('`calendar.%s` is refused BY NAME at its own path', (alias) => {
      expect(codeAndPath(parse({ ...NODE, calendar: { startDateField: 'starts_at', [alias]: 'kickoff' } })))
        .toEqual([{ code: 'invalid_type', path: ['calendar', alias] }]);
    });
  });

  it('the installed row gives the same verdicts on the same blocks', () => {
    const row = (calendar: unknown) => ROW.safeParse({ objectName: 'event', calendar });
    expect(row(FIVE).success).toBe(true);
    for (const key of [CONTROL_KEY, 'defaultView', ...ALIASES.map(([alias]) => alias)]) {
      expect(codeAndPath(row({ startDateField: 'starts_at', [key]: 'week' })))
        .toEqual([{ code: 'unrecognized_keys', path: ['calendar'] }]);
    }
    expect(codeAndPath(row({ titleField: 'subject' })))
      .toEqual([{ code: 'invalid_type', path: ['calendar', 'startDateField'] }]);
  });

  it('CONTROL: `defaultView` written FLAT, where the renderer reads it, still parses', () => {
    const r = ObjectCalendarSchema.safeParse({ ...NODE, calendar: { startDateField: 'starts_at' }, defaultView: 'week' });
    expect(r.success, JSON.stringify(codeAndPath(r))).toBe(true);
  });
});

/* ── 5. The TypeScript face ─────────────────────────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type SpecBlock = NonNullable<SpecObjectCalendarProps['calendar']>;

describe('objectui#6152 round 9 — the TypeScript face is closed the same way', () => {
  it('the derived type has no index signature, a required `startDateField`, and the slot\'s members', () => {
    type _closed = Expect<Equal<string extends keyof ObjectCalendarBlockConfig ? true : false, false>>;
    type _required = Expect<Equal<ObjectCalendarBlockConfig['startDateField'], string>>;
    type _members = Expect<Equal<Exclude<keyof ObjectCalendarBlockConfig, 'dateField' | 'endField'>, keyof SpecBlock>>;
    type _member = Expect<Equal<ObjectCalendarBlockConfig['allDayField'], SpecBlock['allDayField']>>;
    const checks: [_closed, _required, _members, _member] = [true, true, true, true];
    expect(checks).toEqual([true, true, true, true]);
  });

  it('an unknown key, `defaultView`, an alias and a missing start binding are `tsc` errors', () => {
    // Real directives: this package type-checks its tests (`tsconfig.test.json`), so a
    // re-opened container fails on the unused directive.
    // @ts-expect-error the container is closed: an unknown key is refused (objectui#6152 round 9)
    const unknownKey: TsObjectCalendarSchema = { type: 'object-calendar', objectName: 'event', calendar: { startDateField: 'starts_at', zzqxNoSuchField: 'x' } };
    // @ts-expect-error `defaultView` is the FLAT member; the slot does not declare it in the block
    const nested: TsObjectCalendarSchema = { type: 'object-calendar', objectName: 'event', calendar: { startDateField: 'starts_at', defaultView: 'week' } };
    // @ts-expect-error `dateField` is refused by name (objectui#8355)
    const alias: TsObjectCalendarSchema = { type: 'object-calendar', objectName: 'event', calendar: { startDateField: 'starts_at', dateField: 'kickoff' } };
    // @ts-expect-error `startDateField` is required inside the block
    const unbound: TsObjectCalendarSchema = { type: 'object-calendar', objectName: 'event', calendar: { titleField: 'subject' } };
    // Lit control on the same face.
    const live: TsObjectCalendarSchema = { type: 'object-calendar', objectName: 'event', calendar: FIVE, defaultView: 'week' };
    expect([unknownKey, nested, alias, unbound]).toHaveLength(4);
    expect(live.calendar?.startDateField).toBe('starts_at');
  });
});

/* ── 6. The corpus census ───────────────────────────────────────────────────── */

const ROOT = uiRoot();
/**
 * The AUTHORED corpus: the examples and the schema catalog, the docs site, the published
 * skills, the docs tree, the apps (the console's fixtures among them), and every package
 * README. Test files are NOT corpus: they pin refusals on purpose.
 */
const CORPUS_DIRS = ['examples', 'content', 'skills', 'docs', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.source', '.turbo', '__tests__', '__mocks__', 'test', 'tests', 'e2e']);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
/** Release history, not authored corpus: a published CHANGELOG is never re-addressed (AGENTS.md #11). */
const HISTORY_FILE = /^CHANGELOG\.md$/;
const CODE_FILE = /\.([cm]?[jt]sx?|json)$/;
const MARKDOWN_FILE = /\.mdx?$/;
const MARKER = 'object-calendar';
/** An authored element outside a fence, which the fence extractor would not read. */
const UNFENCED_ELEMENT = /["']?type["']?\s*[:=]\s*\{?\s*["'`]object-calendar["'`]/;

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name), out);
    } else if (!TEST_FILE.test(entry.name) && !HISTORY_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

function corpusFiles(): string[] {
  const files: string[] = [];
  for (const dir of CORPUS_DIRS) walk(join(ROOT, dir), files);
  files.push(join(ROOT, 'README.md'));
  for (const pkg of readdirSync(join(ROOT, 'packages'))) {
    const readme = join(ROOT, 'packages', pkg, 'README.md');
    if (existsSync(readme)) files.push(readme);
  }
  return files.filter((file) => readFileSync(file, 'utf8').includes(MARKER));
}

type Container = { at: string; value: unknown };
type Unjudged = { at: string; why: string };

const unwrapExpr = (node: ts.Expression): ts.Expression => {
  let cur = node;
  while (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur;
};
const propName = (p: ts.ObjectLiteralElementLike) =>
  ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
const prop = (obj: ts.ObjectLiteralExpression, key: string) =>
  obj.properties.find((p): p is ts.PropertyAssignment => propName(p) === key);

const NOT_LITERAL = Symbol('not literal');

/** The literal value of an expression, resolving a bare identifier to a `const` in the same source. */
function literal(expr: ts.Expression, source: ts.SourceFile): unknown {
  const node = unwrapExpr(expr);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    const items = node.elements.map((e) => literal(e, source));
    return items.includes(NOT_LITERAL) ? NOT_LITERAL : items;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const p of node.properties) {
      const name = propName(p);
      if (name === undefined) return NOT_LITERAL;
      const v = literal((p as ts.PropertyAssignment).initializer, source);
      if (v === NOT_LITERAL) return NOT_LITERAL;
      out[name] = v;
    }
    return out;
  }
  if (ts.isIdentifier(node)) {
    let found: ts.Expression | undefined;
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === node.text && n.initializer) found = n.initializer;
      ts.forEachChild(n, visit);
    };
    visit(source);
    return found ? literal(found, source) : NOT_LITERAL;
  }
  return NOT_LITERAL;
}

/** Every `object-calendar` element's own container in one source text. */
function containersIn(label: string, text: string, json: boolean, lineOffset: number, found: Container[], unjudged: Unjudged[]): void {
  const source = ts.createSourceFile(label, json ? `(${text})` : text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const type = prop(node, 'type');
      const typeValue = type && unwrapExpr(type.initializer);
      if (typeValue && (ts.isStringLiteral(typeValue) || ts.isNoSubstitutionTemplateLiteral(typeValue)) && typeValue.text === MARKER) {
        const bag = prop(node, 'properties');
        const bagValue = bag && unwrapExpr(bag.initializer);
        const slots = [prop(node, 'calendar'), bagValue && ts.isObjectLiteralExpression(bagValue) ? prop(bagValue, 'calendar') : undefined];
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1 + lineOffset;
        const at = `${label}:${line}`;
        if (!slots.some(Boolean) && node.properties.some(ts.isSpreadAssignment)) {
          unjudged.push({ at, why: 'an element spreads a value that could carry `calendar`' });
        }
        for (const slot of slots) {
          if (!slot) continue;
          const value = literal(slot.initializer, source);
          if (value === NOT_LITERAL) unjudged.push({ at, why: `container is not a literal: ${slot.initializer.getText().slice(0, 60)}` });
          else found.push({ at, value });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const FENCE = /^([ \t]*)(```|~~~)([^\n]*)\n([\s\S]*?)^\1\2[ \t]*$/gm;

function census(files: ReadonlyArray<readonly [string, string]>) {
  const found: Container[] = [];
  const unjudged: Unjudged[] = [];
  for (const [label, text] of files) {
    if (CODE_FILE.test(label)) {
      containersIn(label, text, label.endsWith('.json'), 0, found, unjudged);
    } else if (MARKDOWN_FILE.test(label)) {
      let outside = text;
      for (const m of text.matchAll(FENCE)) {
        outside = outside.replace(m[0], '');
        if (!m[4].includes(MARKER)) continue;
        const lang = m[3].trim().split(/\s/)[0];
        const line = text.slice(0, m.index).split('\n').length;
        containersIn(label, m[4], /^json/.test(lang), line, found, unjudged);
      }
      if (UNFENCED_ELEMENT.test(outside)) unjudged.push({ at: label, why: 'an element authored outside a fence' });
    } else {
      unjudged.push({ at: label, why: 'a file type this census does not parse' });
    }
  }
  return { found, unjudged };
}

describe('objectui#6152 round 9 — the corpus census: every authored container parses on the narrowed door', () => {
  const files = corpusFiles().map((file) => [relative(ROOT, file), readFileSync(file, 'utf8')] as const);
  const { found, unjudged } = census(files);

  it('every authored element\'s container was judged — none is out of the census\'s reach', () => {
    expect(unjudged).toEqual([]);
  });

  it('the census sees authored containers, so a zero below is a reading', () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it('each one parses on this package\'s container AND on the installed slot', () => {
    const refused = found
      .map(({ at, value }) => ({ at, local: codeAndPath(MIRROR.safeParse(value)), upstream: codeAndPath(SLOT.safeParse(value)) }))
      .filter((row) => row.local.length > 0 || row.upstream.length > 0);
    expect(refused).toEqual([]);
  });

  it('CONTROL: the extractor finds and judges a container in each carrier it reads, and fails loudly where it cannot', () => {
    const doc = [
      '```tsx',
      "const a = { type: 'object-calendar', objectName: 'e', calendar: { startDateField: 's', defaultView: 'week' } };",
      "const cfg = { titleField: 't' };",
      "const b = { type: 'object-calendar', objectName: 'e', calendar: cfg };",
      "const c = { type: 'object-calendar', objectName: 'e', calendar: makeConfig() };",
      '```',
      '```json',
      '{ "type": "object-calendar", "properties": { "calendar": { "startDateField": "s" } } }',
      '```',
    ].join('\n');
    const { found: probe, unjudged: missed } = census([
      ['fixture.mdx', doc],
      ['fixture.json', '{ "type": "object-calendar", "calendar": { "startDateField": "s", "zzqxNoSuchField": 1 } }'],
      ['fixture.yaml', 'type: object-calendar'],
    ]);
    expect(probe.map(({ value }) => MIRROR.safeParse(value).success)).toEqual([false, false, true, false]);
    expect(missed.map(({ why }) => why)).toEqual([
      'container is not a literal: makeConfig()',
      'a file type this census does not parse',
    ]);
  });
});
