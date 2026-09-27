import { describe, expect, it } from 'vitest';
import { compile, generateDts, manifestFromConfigs } from '../index.js';

// A tiny public-tier manifest, shaped exactly like getAllConfigs() output.
// Containment is the declared `children` slot input, not `isContainer`
// (objectui#9910) — the flag stays on the fixtures as the layout fact it is.
const manifest = manifestFromConfigs([
  { type: 'flex', namespace: 'ui', isContainer: true, inputs: [
    { name: 'direction', type: 'enum', enum: ['row', 'col'] },
    { name: 'gap', type: 'number' },
    { name: 'wrap', type: 'boolean' },
    { name: 'children', type: 'slot' },
  ] },
  { type: 'card', namespace: 'ui', isContainer: true, inputs: [
    { name: 'title', type: 'string' },
    { name: 'children', type: 'slot' },
  ] },
  { type: 'object-table', namespace: 'plugin-grid', isContainer: false, inputs: [
    { name: 'object', type: 'string', required: true, binding: 'object' },
    { name: 'columns', type: 'array' },
    { name: 'pageSize', type: 'number' },
  ] },
]);

describe('compile (parse + validate)', () => {
  it('compiles valid JSX to a tree and reports requires + bindings', () => {
    const r = compile(
      `<flex direction="row" gap={4} wrap>
         <object-table object="account" columns={["name","amount"]} pageSize={25} />
       </flex>`,
      manifest,
    );
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.tree).toMatchObject({
      type: 'flex',
      direction: 'row',
      gap: 4,
      wrap: true,
      children: [{ type: 'object-table', object: 'account', pageSize: 25 }],
    });
    expect(r.requires.sort()).toEqual(['plugin-grid', 'ui']);
    expect(r.bindings).toEqual([
      { tag: 'object-table', input: 'object', kind: 'object', value: 'account' },
    ]);
  });

  it('rejects unknown components (whitelist = manifest tags)', () => {
    const r = compile(`<flex><script>alert(1)</script></flex>`, manifest);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain('forbidden-tag');
  });

  it('flags a missing required prop (completeness)', () => {
    const r = compile(`<object-table columns={[]} />`, manifest);
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-required-prop' }),
    );
  });

  it('flags an illegal enum value and a coarse type mismatch', () => {
    const r = compile(`<flex direction="diagonal" gap="big" />`, manifest);
    expect(r.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['invalid-enum', 'type-mismatch']),
    );
  });

  it('rejects event handlers and raw-html injection', () => {
    const r = compile(`<card onClick="steal()" dangerouslySetInnerHTML={{}} />`, manifest);
    expect(r.diagnostics.filter((d) => d.code === 'forbidden-attr')).toHaveLength(2);
  });
});

describe('generateDts (the JSX type surface)', () => {
  it('emits a JSX.IntrinsicElements augmentation from the manifest', () => {
    const dts = generateDts(manifest);
    expect(dts).toContain('"object-table": ObjectTableProps;');
    expect(dts).toContain('export interface ObjectTableProps extends SduiBaseProps');
    expect(dts).toContain('object: string;'); // required → not optional
    expect(dts).toContain('pageSize?: number;'); // optional
    expect(dts).toContain('direction?: "row" | "col";'); // enum → union
  });
});
