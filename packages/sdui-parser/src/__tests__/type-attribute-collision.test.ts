/**
 * html tier: an authored `type=` attribute collides with the envelope's own
 * discriminator, and is REFUSED at parse time (objectstack#13957, maintainer
 * ruling 2026-09-01 — ADR-0080 amendment).
 *
 * The two outcomes this replaces are pinned side by side on purpose, because
 * they are the reason the refusal is at parse rather than at the warning layer:
 * one of them produced NO diagnostic at all, and the other produced a loud one
 * pointing somewhere else. A test that only asserted "an error is raised" would
 * pass on the second case before this change.
 */
import { describe, expect, it } from 'vitest';
import { compile, manifestFromConfigs } from '../index.js';
import { parseJsx } from '../parse.js';

const manifest = manifestFromConfigs([
  { type: 'flex', namespace: 'ui', isContainer: true, inputs: [
    { name: 'direction', type: 'enum', enum: ['row', 'col'] },
    { name: 'gap', type: 'number' },
  ] },
  { type: 'grid', namespace: 'ui', isContainer: true, inputs: [{ name: 'columns', type: 'number' }] },
  { type: 'object-chart', namespace: 'plugin-charts', isContainer: false, inputs: [
    { name: 'objectName', type: 'string', binding: 'object' },
  ] },
]);

/** The refusal, as the author sees it: one diagnostic naming BOTH names. */
const refusals = (source: string) =>
  compile(source, manifest).diagnostics.filter((d) => d.code === 'forbidden-attr');

describe('an authored `type` attribute is refused (the discriminator collision)', () => {
  it('refuses when the value names ANOTHER REGISTERED type — the previously SILENT case', () => {
    const r = compile('<flex type="grid" gap={4} />', manifest);

    // Before this change: `grid` resolved in the manifest, every check passed,
    // and the page rendered a grid where the author wrote a flex — zero
    // diagnostics of any severity.
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'forbidden-attr', tag: 'flex' }),
    );

    // ONE diagnostic, naming BOTH the tag and the attribute (the ruled shape).
    const [only, ...rest] = refusals('<flex type="grid" gap={4} />');
    expect(rest).toEqual([]);
    expect(only.message).toContain('"type"');
    expect(only.message).toContain('<flex>');
  });

  it('refuses when the value names NOTHING registered — the previously MISDIRECTED case', () => {
    // `<object-chart type="bar">` is the shape a react-tier author carries
    // across: on that tier `type` is the chart family. Before this change the
    // only diagnostic was `unknown-component` naming `"bar"`, which reads as a
    // missing plugin rather than as an attribute that should not be there.
    const r = compile('<object-chart objectName="invoice" type="bar" />', manifest);

    expect(r.ok).toBe(false);
    expect(refusals('<object-chart objectName="invoice" type="bar" />')).toHaveLength(1);
    expect(r.diagnostics.map((d) => d.code)).not.toContain('unknown-component');
  });

  it('refuses a BARE `type` attribute too — the check is on the name, not the value', () => {
    expect(refusals('<flex type />')).toHaveLength(1);
    expect(refusals('<flex type={{"a":1}} />')).toHaveLength(1);
  });

  it('refuses it on a NESTED element, not only on the root', () => {
    const found = refusals('<flex><grid type="flex" columns={2} /></flex>');
    expect(found).toHaveLength(1);
    expect(found[0].tag).toBe('grid');
    expect(found[0].message).toContain('<grid>');
  });

  it('leaves a clean element alone — no regression', () => {
    const r = compile('<flex direction="row" gap={4}><grid columns={2} /></flex>', manifest);
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.tree).toMatchObject({ type: 'flex', direction: 'row', gap: 4 });
  });
});

/**
 * ⚠️ Read this before trusting the block below as coverage of the spread order.
 *
 * The order fix is DEFENSE IN DEPTH, which means the refusal makes it
 * unobservable through the public API: measured by ablation on the committed
 * tree, restoring `{ type: tag, ...props }` while LEAVING the refusal in place
 * keeps all eight of these tests GREEN, because the refused attribute never
 * reaches `props` to be spread. What turns them red is removing the refusal
 * (5 red) and, additionally, the two spread-order assertions here when BOTH
 * halves are removed together (6 red).
 *
 * So these tests pin the discriminator's identity, not the statement that
 * produces it. That is not a gap to paper over with a stronger-sounding
 * assertion — it is the ruled relationship between the two halves («拒绝使覆盖
 * 不可达,顺序修复是防御纵深»), and it is stated here so the next author does
 * not read a green suite as proof the order is load-bearing on its own.
 */
describe('spread order — defense in depth behind the refusal', () => {
  it('keeps the TAG as the discriminator even when a `type` attribute was authored', () => {
    // Parser-level, with no manifest: the refusal is a diagnostic, and the tree
    // is still built. What must never happen is the tree carrying the AUTHOR's
    // value as its discriminator — that is the silent redirect itself.
    const { tree, diagnostics } = parseJsx('<flex type="grid" gap={4} />');

    expect(tree?.type).toBe('flex');
    expect(diagnostics.map((d) => d.code)).toContain('forbidden-attr');
  });

  it('and does not let the refused value land under its own name either', () => {
    const { tree } = parseJsx('<flex type="grid" />');
    expect(Object.values(tree ?? {})).not.toContain('grid');
  });

  it('every other prop still survives the reordered spread', () => {
    const { tree } = parseJsx('<flex direction="col" gap={8} wrap><grid columns={3} /></flex>');
    expect(tree).toMatchObject({
      type: 'flex',
      direction: 'col',
      gap: 8,
      wrap: true,
      children: [{ type: 'grid', columns: 3 }],
    });
  });
});
