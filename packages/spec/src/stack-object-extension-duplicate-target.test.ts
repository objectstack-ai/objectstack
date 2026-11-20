/**
 * [#35228 ruling A] One `objectExtensions` entry per target per package,
 * refused wherever authoring reaches — the #22934 identity check, with its own
 * wording, at the doors it did not reach:
 *
 * - the ONE package a flat `composeStacks` makes of its inputs (two sub-stacks
 *   of one package, each extending one object — the natural way to write
 *   "extended in two places");
 * - every `packages[i]` body, of a hand-built `defineStack({ packages })` and
 *   of a composition that carries bodies.
 *
 * Measured on main `e35cf035` before the fix (the card's decision analysis,
 * premise 2): the single stack was refused already, while the composition and
 * the `packages[i]` body were ACCEPTED carrying both entries, and the
 * registrar then served only the last entry's fields.
 *
 * Cross-package reuse stays allowed (ADR-0048 §3.4): two packages each
 * extending one target compose, each body judged on its own. Two bodies under
 * ONE package id are the boot's own `DUPLICATE_ARTIFACT_PACKAGE` refusal and
 * are not re-judged here.
 *
 * The runtime half of the ruling (arm A1: an artifact built before this fix
 * still loads, with an error line) is pinned in `packages/objectql`
 * (`engine-same-target-object-extensions-log.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';

const sales = { id: 'com.example.sales', namespace: 'crm', name: 'sales', version: '1.0.0', type: 'app' as const };
const billing = { id: 'com.example.billing', namespace: 'crm', name: 'billing', version: '1.0.0', type: 'module' as const };
const ops = { id: 'com.example.ops', namespace: 'crm', name: 'ops', version: '1.0.0', type: 'module' as const };

const line = { name: 'crm_line', label: 'Line', sharingModel: 'private' as const, fields: { title: { type: 'text' as const, label: 'Title' } } };
const extension = (field: string) => ({ extend: 'crm_line', fields: { [field]: { type: 'text' as const, label: field } } });

const CONSEQUENCE_AND_REMEDY =
  "The runtime applies one extension of a target object per package, so only the last of these entries' fields " +
  "register and the others' are silently dropped. Merge them into a single `objectExtensions` entry for 'crm_line'.";

interface Refusal { name?: string; code?: string; status?: number; issues?: readonly string[]; message: string }

function refusalOf(run: () => unknown): Refusal | null {
  try {
    run();
    return null;
  } catch (e) {
    return e as Refusal;
  }
}

function expectEnvelope(r: Refusal | null, header: string): asserts r is Refusal {
  expect(r, 'refused').not.toBeNull();
  expect(r!.name).toBe('StackCrossReferenceError');
  expect(r!.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  expect(r!.status).toBe(422);
  expect(r!.issues).toHaveLength(1);
  expect(r!.message).toContain(`${header} (1 issue):`);
  expect(r!.message).toContain(`  ✗ ${r!.issues![0]}`);
}

describe('#35228 — two objectExtensions entries for one target in one package are refused at every door', () => {
  it('a single stack: the #22934 refusal, byte for byte as before', () => {
    const r = refusalOf(() =>
      defineStack({ manifest: sales, objects: [line], objectExtensions: [extension('cb_account'), extension('cb_other')] }),
    );
    expectEnvelope(r, 'defineStack cross-reference validation failed');
    expect(r.issues![0]).toBe(
      "Object extension of 'crm_line' is declared twice in `objectExtensions`: stack.objectExtensions[0] and " +
        `stack.objectExtensions[1]. ${CONSEQUENCE_AND_REMEDY}`,
    );
  });

  it('a flat composition of three sub-stacks of one package, two of them extending one target: refused, naming both', () => {
    const r = refusalOf(() =>
      composeStacks([
        defineStack({ manifest: sales, objects: [line] }),
        defineStack({ objectExtensions: [extension('cb_account')] }),
        defineStack({ objectExtensions: [extension('cb_other')] }),
      ]),
    );
    expectEnvelope(r, 'composeStacks artifact cross-reference validation failed');
    expect(r.issues![0]).toBe(
      "Object extension of 'crm_line' is declared twice in `objectExtensions`: stack #1 objectExtensions[0] and " +
        `stack #2 objectExtensions[0]. ${CONSEQUENCE_AND_REMEDY}`,
    );
  });

  it('every manifest pick that composes ONE package refuses it: first, last and an index', () => {
    const inputs = () => [
      defineStack({ manifest: sales, objects: [line], objectExtensions: [extension('cb_account')] }),
      defineStack({ manifest: sales, objectExtensions: [extension('cb_other')] }),
    ];
    for (const pick of ['first', 'last', 1] as const) {
      const r = refusalOf(() => composeStacks(inputs(), { manifest: pick }));
      expect(r?.code, String(pick)).toBe('STACK_CROSS_REFERENCE_INVALID');
      expect(r?.issues?.[0]).toContain(
        "`objectExtensions`: 'com.example.sales' (stack #0) objectExtensions[0] and 'com.example.sales' (stack #1) objectExtensions[0]. ",
      );
    }
  });

  it('a hand-built `packages[i]` body with two entries for one target: refused at the body\'s path', () => {
    const r = refusalOf(() =>
      defineStack({
        manifest: sales,
        packages: [
          { manifest: { ...sales, objects: [line] } },
          { manifest: { ...billing, objectExtensions: [extension('cb_account'), extension('cb_other')] } },
        ],
      } as never),
    );
    expectEnvelope(r, 'defineStack cross-reference validation failed');
    expect(r.issues![0]).toBe(
      "Object extension of 'crm_line' is declared twice in `objectExtensions`: " +
        'stack.packages[1].manifest.objectExtensions[0] and stack.packages[1].manifest.objectExtensions[1]. ' +
        CONSEQUENCE_AND_REMEDY,
    );
  });

  it('a composition carrying such a body (a nested artifact built without the strict pass): refused, labelled by the input that carried it', () => {
    const nested = defineStack(
      { manifest: billing, packages: [{ manifest: { ...billing, objectExtensions: [extension('cb_account'), extension('cb_other')] } }] } as never,
      { strict: false },
    );
    for (const pick of ['last', 'preserve'] as const) {
      const r = refusalOf(() => composeStacks([defineStack({ manifest: sales, objects: [line] }), nested], { manifest: pick }));
      expect(r?.code, pick).toBe('STACK_CROSS_REFERENCE_INVALID');
      expect(r?.issues).toEqual([
        "Object extension of 'crm_line' is declared twice in `objectExtensions`: " +
          "'com.example.billing' (stack #1) packages[0].manifest.objectExtensions[0] and " +
          "'com.example.billing' (stack #1) packages[0].manifest.objectExtensions[1]. " +
          CONSEQUENCE_AND_REMEDY,
      ]);
    }
  });

  it('under `preserve`, an input with a manifest whose own collection carries the pair (built without the strict pass) is refused as its body', () => {
    const loose = defineStack(
      { manifest: billing, objectExtensions: [extension('cb_account'), extension('cb_other')] } as never,
      { strict: false },
    );
    const r = refusalOf(() => composeStacks([defineStack({ manifest: sales, objects: [line] }), loose], { manifest: 'preserve' }));
    expect(r?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(r?.issues?.[0]).toContain(
      "`objectExtensions`: 'com.example.billing' (stack #1) objectExtensions[0] and 'com.example.billing' (stack #1) objectExtensions[1]. ",
    );
  });
});

describe('#35228 review S2 — the residual package under `preserve` is judged as one package', () => {
  const page = (label: string) => ({ name: 'home', label, type: 'app' as const, regions: [] });

  it('two manifest-less inputs each declaring page `home`: refused, naming both', () => {
    const r = refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line] }),
          defineStack({ pages: [page('A')] }),
          defineStack({ pages: [page('B')] }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectEnvelope(r, 'composeStacks artifact cross-reference validation failed');
    expect(r.issues![0]).toBe(
      "Page 'home' is declared twice in `pages`: stack #1 pages[0] and stack #2 pages[0]. The runtime registers " +
        'pages by name, so only the last of these entries is kept and the others are silently dropped. Rename one ' +
        'of them, or merge them into a single entry.',
    );
  });

  it('two manifest-less inputs each extending one target: refused, naming both', () => {
    const r = refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line] }),
          defineStack({ objectExtensions: [extension('cb_account')] }),
          defineStack({ objectExtensions: [extension('cb_other')] }),
        ],
        { manifest: 'preserve' },
      ),
    );
    expectEnvelope(r, 'composeStacks artifact cross-reference validation failed');
    expect(r.issues![0]).toBe(
      "Object extension of 'crm_line' is declared twice in `objectExtensions`: stack #1 objectExtensions[0] and " +
        `stack #2 objectExtensions[0]. ${CONSEQUENCE_AND_REMEDY}`,
    );
  });

  it('CONTROL: a manifest-less input beside a body that declares the same name is the body\'s slot, not a residual pair', () => {
    expect(refusalOf(() =>
      composeStacks(
        [
          defineStack({ manifest: sales, objects: [line], pages: [page('A')] }),
          defineStack({ pages: [page('B')] }),
        ],
        { manifest: 'preserve' },
      ),
    )).toBeNull();
  });
});

describe('#35228 review S1 — a nested artifact\'s flattened copies of its bodies are not one package', () => {
  it('a preserve artifact with two packages each extending one target, nested in a flat composition: accepted', () => {
    // A manifest-less input keeps the flattened top level (its page has no
    // body to carry it), so the nested artifact carries both packages'
    // extensions side by side at its top level as well as in their bodies.
    const nested = composeStacks(
      [
        defineStack({ manifest: sales, objects: [line] }),
        defineStack({ manifest: billing, objectExtensions: [extension('cb_account')] }),
        defineStack({ manifest: ops, objectExtensions: [extension('cb_other')] }),
        defineStack({ pages: [{ name: 'crm_home', label: 'Home', type: 'app', regions: [] }] }),
      ],
      { manifest: 'preserve' },
    );
    expect((nested as unknown as { objectExtensions?: unknown[] }).objectExtensions, 'anti-vacuity: the flattened copy is there').toHaveLength(2);
    for (const pick of ['last', 'preserve'] as const) {
      expect(
        refusalOf(() => composeStacks([nested, defineStack({ pages: [{ name: 'crm_other', label: 'Other', type: 'app', regions: [] }] })], { manifest: pick }))?.message ?? null,
        pick,
      ).toBeNull();
    }
  });

  it('…while the nested artifact\'s own residual pair is still refused', () => {
    const nested = composeStacks(
      [
        defineStack({ manifest: sales, objects: [line] }),
        defineStack({ manifest: billing, objectExtensions: [extension('cb_account')] }),
        defineStack({ pages: [{ name: 'crm_home', label: 'Home', type: 'app', regions: [] }] }),
      ],
      { manifest: 'preserve' },
    );
    const r = refusalOf(() =>
      composeStacks([nested, defineStack({ pages: [{ name: 'crm_home', label: 'Second', type: 'app', regions: [] }] })]),
    );
    expect(r?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(r?.issues?.[0]).toMatch(/^Page 'crm_home' is declared twice in `pages`: '[a-z.]+' \(stack #0\) pages\[0\] and stack #1 pages\[0\]\. /);
  });
});

describe('#35228 review S3 — one entry reached twice', () => {
  it('a hook reached twice is refused: a built artifact binds each copy', () => {
    const sub = defineStack({ hooks: [{ name: 'crm_line_touch', object: 'crm_line', events: ['beforeInsert'], handler: () => {} }] });
    const r = refusalOf(() => composeStacks([defineStack({ manifest: sales, objects: [line] }), sub, sub]));
    expect(r?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(r?.issues?.[0]).toContain("Hook 'crm_line_touch' is declared twice in `hooks`: stack #1 hooks[0] and stack #2 hooks[0]. ");
  });
});

describe('#35228 — CONTROL: what stays accepted', () => {
  it('two packages under `preserve`, each extending one target once: composed, each body carrying its own entry', () => {
    const artifact = composeStacks(
      [
        defineStack({ manifest: sales, objects: [line] }),
        defineStack({ manifest: billing, objectExtensions: [extension('cb_account')] }),
        defineStack({ manifest: ops, objectExtensions: [extension('cb_other')] }),
      ],
      { manifest: 'preserve' },
    ) as unknown as { packages: Array<{ manifest: { id: string; objectExtensions?: unknown[] } }> };
    expect(artifact.packages.map((p) => [p.manifest.id, p.manifest.objectExtensions?.length ?? 0])).toEqual([
      ['com.example.sales', 0],
      ['com.example.billing', 1],
      ['com.example.ops', 1],
    ]);
  });

  it('two hand-built bodies of two packages each extending one target: accepted', () => {
    expect(refusalOf(() =>
      defineStack({
        manifest: sales,
        packages: [
          { manifest: { ...sales, objects: [line] } },
          { manifest: { ...billing, objectExtensions: [extension('cb_account')] } },
          { manifest: { ...ops, objectExtensions: [extension('cb_other')] } },
        ],
      } as never),
    )).toBeNull();
  });

  it('one package extending two targets once each, over two sub-stacks: accepted', () => {
    const note = { ...line, name: 'crm_note', label: 'Note' };
    const composed = composeStacks([
      defineStack({ manifest: sales, objects: [line, note] }),
      defineStack({ objectExtensions: [extension('cb_account')] }),
      defineStack({ objectExtensions: [{ extend: 'crm_note', fields: { cb_other: { type: 'text', label: 'Other' } } }] }),
    ]) as unknown as { objectExtensions: unknown[] };
    expect(composed.objectExtensions).toHaveLength(2);
  });

  it('the same built sub-stack passed twice is one declaration reached twice, not two', () => {
    const sub = defineStack({ objectExtensions: [extension('cb_account')] });
    expect(refusalOf(() => composeStacks([defineStack({ manifest: sales, objects: [line] }), sub, sub]))).toBeNull();
  });
});
