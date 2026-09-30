/**
 * The base-prop list, ported in lockstep from objectui (objectui#11008 added
 * `bind` / `hidden`; objectui#11044 made ONE list with an `every-node` and a
 * `where-undeclared` scope) at the console pin `db11afd4967c`.
 *
 * Three facts, kept apart:
 *  1. every `every-node` member draws no `unknown-prop`;
 *  2. a `where-undeclared` member draws none where the type declares no input
 *     of that name;
 *  3. a `where-undeclared` member the type DECLARES keeps its declared type
 *     check (the reason it is not `every-node`).
 * Measured on the tracked `sdui.manifest.json`: no component declares any of
 * the five newly-`every-node` keys, so no declared type check moves.
 */
import { describe, expect, it } from 'vitest';
import { generateDts, manifestFromConfigs, validateTree } from '../index.js';
import { SDUI_BASE_PROPS } from '../validate.js';
import type { Manifest, SchemaElement } from '../types.js';

const manifest: Manifest = manifestFromConfigs([
  { type: 'leaf', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
  // `label` declared as a string, the `badge` / `button` shape
  { type: 'labelled', namespace: 'ui', inputs: [{ name: 'label', type: 'string' }] },
]);

const codes = (node: SchemaElement): string[] =>
  validateTree(node, manifest).diagnostics.map((d) => d.code);

const EVERY_NODE = [
  'id', 'className', 'style', 'visible', 'visibleWhen', 'visibleOn', 'hidden',
  'hiddenOn', 'disabled', 'disabledOn', 'bind', 'testId', 'children',
];
// `type` is the one `every-node` entry with no attribute form: on a node it
// IS the tag, so a node cannot carry it without being the component under test.
// It is pinned through the list below, not through `validateTree`.
const WHERE_UNDECLARED = ['name', 'label', 'description', 'placeholder', 'data', 'ariaLabel'];

describe('base props — one list, two scopes (objectui#11008, #11044)', () => {
  it.each(EVERY_NODE)('every-node `%s` draws no unknown-prop', (key) => {
    const node = { type: 'leaf', [key]: key === 'children' ? [] : 'x' } as SchemaElement;
    expect(codes(node)).not.toContain('unknown-prop');
  });

  it.each(WHERE_UNDECLARED)('undeclared `%s` draws no unknown-prop', (key) => {
    expect(codes({ type: 'leaf', [key]: 'x' } as SchemaElement)).toEqual([]);
  });

  it('a DECLARED where-undeclared key keeps its type check', () => {
    const diags = validateTree({ type: 'labelled', label: 5 } as SchemaElement, manifest).diagnostics;
    expect(diags.map((d) => d.code)).toEqual(['type-mismatch']);
    expect(validateTree({ type: 'labelled', label: 'ok' } as SchemaElement, manifest).diagnostics).toEqual([]);
  });

  it('the list is the 20 entries, `type` alone having no attribute type', () => {
    expect(SDUI_BASE_PROPS.map((p) => p.name)).toEqual(['type', ...EVERY_NODE, ...WHERE_UNDECLARED]);
    expect(SDUI_BASE_PROPS.filter((p) => p.tsType === null).map((p) => p.name)).toEqual(['type']);
    expect(SDUI_BASE_PROPS.filter((p) => p.scope === 'every-node').map((p) => p.name)).toEqual(['type', ...EVERY_NODE]);
  });

  it('a non-base key is still unknown', () => {
    expect(codes({ type: 'leaf', nonsense: 1 } as SchemaElement)).toEqual(['unknown-prop']);
  });
});

describe('generateDts — `SduiBaseProps` is emitted from the same list', () => {
  const dts = generateDts(manifest);
  const emitted = /export interface SduiBaseProps \{\n([\s\S]*?)\n\}/.exec(dts)?.[1].split('\n') ?? [];

  it('carries every list entry that has an attribute type, in list order, and nothing else', () => {
    expect(emitted).toEqual(
      SDUI_BASE_PROPS.filter((p) => p.tsType !== null).map((p) => `  ${p.name}?: ${p.tsType};`),
    );
    expect(emitted).toContain('  bind?: string;');
    expect(emitted).toContain('  hidden?: boolean;');
  });

  it('a component extends the whole base when it declares no base attribute', () => {
    expect(dts).toContain('export interface LeafProps extends SduiBaseProps {');
  });

  it('a component that declares a base attribute Omits exactly that one from the base', () => {
    expect(dts).toContain('export interface LabelledProps extends Omit<SduiBaseProps, "label"> {\n  label?: string;\n}');
  });
});
