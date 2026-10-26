/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The base props are ONE list, and both of its readers read it (objectui#11044).
 *
 * `validateTree`'s `unknown-prop` branch and `generateDts`'s `SduiBaseProps`
 * used to keep separate hand-written copies of the base-prop list. They
 * drifted: after objectui#11008 the validator accepted `bind` and `hidden` on
 * every node, and the generated JSX types still refused both
 * (`TS2322 … Property bind does not exist on type ListProps`). Both now read
 * `SDUI_BASE_PROPS`. This file pins the tier's reading of a manifest; the
 * live-registry half is
 * `packages/components/src/renderers/__tests__/base-props-one-list-11044.test.tsx`.
 *
 * Four facts, kept apart because each fails differently:
 *
 *   - ONE LIST: the generated `SduiBaseProps` block is exactly the list's
 *     attribute entries, and every entry is accepted on a node that declares
 *     nothing, while a near-miss spelling still draws `unknown-prop` (the lit
 *     control — without it, "draws nothing" would also pass against a tier
 *     that stopped warning on undeclared keys);
 *   - MEMBER 1: `visibleWhen`, `hiddenOn` and `testId` are accepted on every
 *     node, as `bind` and `hidden` are;
 *   - MEMBER 2 (the triage ruling): a `'where-undeclared'` member is a base
 *     prop only where the type declares no input of that name. Where one does,
 *     the declared input wins, `type-mismatch` included;
 *   - MEMBER 3: the generated `.d.ts`, compiled by `tsc`, accepts the base
 *     props on a type that declares none of them, refuses a near-miss, and
 *     lets a declared input's type win without a TS2430 conflict — for an
 *     `'every-node'` member too (objectui#11075): `notice` declares `visible`
 *     wider than the base `boolean`, as `record:alert` does in the live
 *     registry. The real public manifest's half is
 *     `apps/console/src/__tests__/sdui-intrinsics-compile-11075.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { generateDts, manifestFromConfigs, SDUI_BASE_PROPS, validateTree } from '../index.js';
import type { Diagnostic, SchemaElement } from '../types.js';

/**
 * `leaf` declares none of the base props, as no live registration declares
 * any `'every-node'` member added here. `field` declares every
 * `'where-undeclared'` member as a typed input — the input-family shape — and
 * two of them with a type the base one does not admit (`label` takes any
 * object, `data` only an array). `notice` declares three `'every-node'`
 * members (objectui#11075): `visible` with the three arms `record:alert`
 * declares, which the base `boolean` does not admit, and `disabled` /
 * `className` with the base type; its `children` input is a slot.
 */
const manifest = manifestFromConfigs([
  { type: 'leaf', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
  {
    type: 'field',
    namespace: 'ui',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'label', type: ['string', 'object'] },
      { name: 'description', type: 'string' },
      { name: 'placeholder', type: 'string' },
      { name: 'data', type: 'array' },
      { name: 'ariaLabel', type: 'string' },
    ],
  },
  {
    type: 'list',
    namespace: 'ui',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'items', type: 'array' },
    ],
  },
  {
    type: 'notice',
    namespace: 'ui',
    inputs: [
      { name: 'message', type: 'string' },
      { name: 'visible', type: ['boolean', 'string', 'object'] },
      { name: 'disabled', type: 'boolean' },
      { name: 'className', type: 'string' },
      { name: 'children', type: 'slot' },
    ],
  },
] as unknown as Parameters<typeof manifestFromConfigs>[0]);

const diagnose = (node: unknown): Diagnostic[] =>
  validateTree(node as SchemaElement, manifest).diagnostics;

const LEAF = { type: 'leaf', content: 'x' };

/** A value of the kind `BaseSchema` declares for each member. */
const WELL_TYPED: Record<string, unknown> = {
  id: 'n1',
  className: 'p-2',
  style: { padding: 4 },
  visible: true,
  visibleWhen: "data.role == 'admin'",
  visibleOn: "data.role == 'admin'",
  hidden: true,
  hiddenOn: "data.role != 'admin'",
  disabled: false,
  disabledOn: 'data.locked',
  bind: 'users',
  testId: 'users-list',
  children: [],
  name: 'email',
  label: 'Email',
  description: 'Where we write',
  placeholder: 'you@example.com',
  data: [{ id: 1 }],
  ariaLabel: 'Email address',
};

const WHERE_UNDECLARED = SDUI_BASE_PROPS.filter((p) => p.scope === 'where-undeclared').map((p) => p.name);

describe('objectui#11044 — the base props are one list, read by the validator and the codegen', () => {
  it('the list names each key once, and every attribute entry has a value to test it with', () => {
    const names = SDUI_BASE_PROPS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    // `type` is the one entry that is no attribute: the tag name carries it.
    expect(SDUI_BASE_PROPS.filter((p) => p.tsType === null).map((p) => p.name)).toEqual(['type']);
    expect(Object.keys(WELL_TYPED).sort()).toEqual(names.filter((n) => n !== 'type').sort());
  });

  it('the generated `SduiBaseProps` is exactly the list, in order, with each entry’s type', () => {
    const block = generateDts(manifest).match(/export interface SduiBaseProps \{\n([\s\S]*?)\n\}\n/);
    expect(block, 'no SduiBaseProps interface in the generated d.ts').toBeTruthy();
    expect(block![1].split('\n')).toEqual(
      SDUI_BASE_PROPS.filter((p) => p.tsType !== null).map((p) => `  ${p.name}?: ${p.tsType};`),
    );
  });

  it('the control node draws nothing', () => {
    expect(diagnose(LEAF)).toEqual([]);
  });

  it.each(Object.keys(WELL_TYPED))('`%s` draws nothing on a node that declares no input of that name', (key) => {
    expect(diagnose({ ...LEAF, [key]: WELL_TYPED[key] })).toEqual([]);
  });

  it.each([
    ['testid', 'n1'],
    ['visibleIf', 'data.x'],
    ['hiddenWhen', 'data.x'],
    ['aria-label', 'x'],
  ] as const)('lit control: the near-miss `%s` still draws one `unknown-prop` naming it', (key, value) => {
    const found = diagnose({ ...LEAF, [key]: value });
    expect(found.map((d) => d.code)).toEqual(['unknown-prop']);
    expect(found[0]!.message).toContain(`"${key}"`);
  });
});

describe('objectui#11044 member 1 — `visibleWhen`, `hiddenOn` and `testId` are base props of every node', () => {
  it.each(['visibleWhen', 'hiddenOn', 'testId'])('`%s` is an `every-node` member', (key) => {
    expect(SDUI_BASE_PROPS.find((p) => p.name === key)?.scope).toBe('every-node');
    expect(diagnose({ ...LEAF, [key]: WELL_TYPED[key] })).toEqual([]);
  });
});

describe('objectui#11044 member 2 — a declared input outranks a `where-undeclared` base prop', () => {
  it('the six subset-declared `BaseSchema` members are the `where-undeclared` ones', () => {
    expect([...WHERE_UNDECLARED].sort()).toEqual(['ariaLabel', 'data', 'description', 'label', 'name', 'placeholder']);
  });

  it.each(WHERE_UNDECLARED)('`%s`: where the type declares it, a wrong-typed value keeps its `type-mismatch`', (key) => {
    expect(diagnose({ type: 'field', [key]: WELL_TYPED[key] })).toEqual([]);
    const found = diagnose({ type: 'field', [key]: 424242 });
    expect(found.map((d) => d.code)).toEqual(['type-mismatch']);
    expect(found[0]!.message).toContain(`"${key}"`);
  });

  it.each(WHERE_UNDECLARED)('`%s`: where the type does not declare it, it is a base prop and draws nothing', (key) => {
    expect(diagnose({ ...LEAF, [key]: WELL_TYPED[key] })).toEqual([]);
  });
});

/** One statement per line: diagnostics are mapped back to cases BY LINE. */
const TSX_CASES: ReadonlyArray<{ what: string; code: string; rejected: boolean }> = [
  { what: 'control: declared inputs', rejected: false, code: `export const c0 = <list title="Users" items={['Ada']} />;` },
  { what: '`bind` (objectui#11008)', rejected: false, code: `export const c1 = <list bind="users" />;` },
  { what: '`hidden` (objectui#11008)', rejected: false, code: `export const c2 = <list hidden={true} />;` },
  { what: '`visibleWhen`', rejected: false, code: `export const c3 = <list visibleWhen="data.role == 'admin'" />;` },
  { what: '`hiddenOn`', rejected: false, code: `export const c4 = <list hiddenOn="data.archived" />;` },
  { what: '`testId`', rejected: false, code: `export const c5 = <list testId="users-list" />;` },
  { what: 'an undeclared `label`', rejected: false, code: `export const c6 = <list label="Users" />;` },
  { what: 'lit control: a near-miss', rejected: true, code: `export const c7 = <list bindTo="users" />;` },
  { what: 'a declared `data` array', rejected: false, code: `export const c8 = <field data={['a']} />;` },
  { what: 'the declared `data` type wins over the base one', rejected: true, code: `export const c9 = <field data={{ a: 1 }} />;` },
  { what: 'the base `data` type where undeclared', rejected: false, code: `export const c10 = <list data={{ a: 1 }} />;` },
  { what: 'objectui#11075: a declared `visible` takes a string', rejected: false, code: `export const c11 = <notice visible="data.open" />;` },
  { what: 'objectui#11075: a declared `visible` takes an envelope', rejected: false, code: `export const c12 = <notice visible={{ dialect: 'cel', source: 'data.open' }} />;` },
  { what: 'objectui#11075: a declared `visible` still judges the value', rejected: true, code: `export const c13 = <notice visible={1} />;` },
  { what: 'objectui#11075 control: the base `visible` stays `boolean` where undeclared', rejected: true, code: `export const c14 = <list visible="data.open" />;` },
  { what: 'objectui#11075: a declared `slot` keeps the base `children`', rejected: false, code: `export const c15 = <notice className="p-2" disabled={false}><list /></notice>;` },
];

/** `tsc` over the generated `.d.ts` plus one page, in memory. */
function typeCheck(): { dts: readonly ts.Diagnostic[]; erroredLines: ReadonlySet<number> } {
  const files: Record<string, string> = {
    '/sdui-probe/sdui-intrinsics.d.ts': generateDts(manifest),
    '/sdui-probe/page.tsx': `${TSX_CASES.map((c) => c.code).join('\n')}\n`,
  };
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName in files
      ? ts.createSourceFile(fileName, files[fileName]!, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName in files || fileExists(fileName);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => files[fileName] ?? readFile(fileName);
  const program = ts.createProgram(Object.keys(files), options, host);
  const all = ts.getPreEmitDiagnostics(program);
  const page = all.filter((d) => d.file?.fileName === '/sdui-probe/page.tsx');
  return {
    dts: all.filter((d) => d.file?.fileName !== '/sdui-probe/page.tsx'),
    erroredLines: new Set(
      page.map((d) => d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line),
    ),
  };
}

describe('objectui#11044 member 3 — the generated JSX types read the same list', () => {
  const { dts, erroredLines } = typeCheck();

  it('the generated `.d.ts` itself compiles — a declared type the base one does not admit is no TS2430', () => {
    expect(dts.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
    expect(generateDts(manifest)).toContain(
      'export interface FieldProps extends Omit<SduiBaseProps, "name" | "label" | "description" | "placeholder" | "data" | "ariaLabel"> {',
    );
    expect(generateDts(manifest)).toContain('export interface ListProps extends SduiBaseProps {');
  });

  it('objectui#11075: every declared `every-node` attribute is `Omit`ted, in declaration order, and the base is unmoved', () => {
    const dts = generateDts(manifest);
    // `children` is declared too, but as a slot: no attribute, so no `Omit`.
    expect(dts).toContain('export interface NoticeProps extends Omit<SduiBaseProps, "visible" | "disabled" | "className"> {');
    expect(dts).toContain('  visible?: boolean | string | Record<string, unknown>;');
    const base = dts.match(/export interface SduiBaseProps \{\n([\s\S]*?)\n\}\n/)?.[1].split('\n') ?? [];
    expect(base).toContain('  visible?: boolean;');
    expect(base).toContain('  children?: unknown;');
  });

  it.each(TSX_CASES.map((c, line) => [c.what, c.rejected, line] as const))(
    '%s — rejected: %s',
    (_what, rejected, line) => {
      expect(erroredLines.has(line)).toBe(rejected);
    },
  );
});
