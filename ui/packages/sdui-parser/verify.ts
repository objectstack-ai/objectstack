/* Standalone functional verification (run with tsx — no vitest infra needed). */
import assert from 'node:assert/strict';
import { compile, generateDts, manifestFromConfigs } from './src/index.ts';

const manifest = manifestFromConfigs([
  { type: 'flex', namespace: 'ui', isContainer: true, inputs: [
    { name: 'direction', type: 'enum', enum: ['row', 'col'] },
    { name: 'gap', type: 'number' },
    { name: 'wrap', type: 'boolean' },
    { name: 'children', type: 'slot' },
  ] },
  { type: 'card', namespace: 'ui', isContainer: true, inputs: [{ name: 'title', type: 'string' }, { name: 'children', type: 'slot' }] },
  { type: 'object-table', namespace: 'plugin-grid', isContainer: false, inputs: [
    { name: 'object', type: 'string', required: true, binding: 'object' },
    { name: 'columns', type: 'array' },
    { name: 'pageSize', type: 'number' },
  ] },
]);

const check = (_name: string, fn: () => void) => {
  fn();
};

check('compiles valid JSX → tree + requires + bindings', () => {
  const r = compile(
    `<flex direction="row" gap={4} wrap>
       <object-table object="account" columns={["name","amount"]} pageSize={25} />
     </flex>`,
    manifest,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.tree?.type, 'flex');
  assert.equal((r.tree as any).gap, 4);
  assert.equal((r.tree as any).wrap, true);
  assert.deepEqual(r.requires.sort(), ['plugin-grid', 'ui']);
  assert.deepEqual(r.bindings, [{ tag: 'object-table', input: 'object', kind: 'object', value: 'account' }]);
});

check('rejects unknown component via whitelist', () => {
  const r = compile(`<flex><script>alert(1)</script></flex>`, manifest);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'forbidden-tag'));
});

check('flags missing required prop', () => {
  const r = compile(`<object-table columns={[]} />`, manifest);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((d) => d.code === 'missing-required-prop'));
});

check('flags illegal enum + coarse type mismatch', () => {
  const r = compile(`<flex direction="diagonal" gap="big" />`, manifest);
  const codes = r.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('invalid-enum'));
  assert.ok(codes.includes('type-mismatch'));
});

check('rejects event handlers + raw-html injection', () => {
  const r = compile(`<card onClick="steal()" dangerouslySetInnerHTML={{}} />`, manifest);
  assert.equal(r.diagnostics.filter((d) => d.code === 'forbidden-attr').length, 2);
});

check('codegen emits a JSX.IntrinsicElements augmentation', () => {
  const dts = generateDts(manifest);
  assert.ok(dts.includes('"object-table": ObjectTableProps;'));
  assert.ok(dts.includes('object: string;'));
  assert.ok(dts.includes('pageSize?: number;'));
  assert.ok(dts.includes('direction?: "row" | "col";'));
});
