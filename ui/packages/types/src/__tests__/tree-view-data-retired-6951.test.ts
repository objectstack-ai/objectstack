/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `TreeViewSchema.data` is REFUSED on both published faces and
 * no longer READ by the renderer (objectui#6951 B1, ADR-0049 enforce-or-remove).
 * Maintainer ruling B1 of 2026-09-04: retire `data`; `nodes` is the only inline
 * spelling; `nodes` stays OPTIONAL; no presence refinement.
 *
 * ## What was measured before the retirement
 *
 * `TreeViewSchema` declared two spellings for its one inline-nodes slot —
 * `nodes` (read second) and `data` (read third, after a `bind`-resolved value
 * and after `nodes`) — both declared by objectui#6150. `data` had been REQUIRED
 * until objectui#6939 / PR #7533 made it optional, which is the state this
 * retirement starts from. Corpus at the retirement: four catalog entries plus
 * the nested tree in `components-complex-resizable/editor-interface.json` on
 * `nodes`; `packages/types/examples/data-display-examples.json` and the
 * `content/docs/api/schema-reference.md` fence on `data` — both rewritten to
 * `nodes`; no package source authored either.
 *
 * ## The trap this pin exists to keep visible — `BaseSchema.data`
 *
 * `BaseSchema` declares `data?: any` (`z.any().optional()` on the mirror) and is
 * `.passthrough()`. So DELETING the member from `TreeViewSchema` would not
 * refuse an authored `data`: the key would be ADMITTED, unvalidated, through
 * the base member — and with the renderer no longer reading it, drawn as an
 * empty tree. The retirement therefore has to be a tombstone on the EXTENDED
 * schema that SHADOWS the base member, and the fact that it does is not
 * assumed here — it is measured: the base alone accepts the very document the
 * extended schema refuses (the "base control" below), on both faces.
 *
 * ## What the ruling deliberately did NOT do
 *
 * No `nodes`-required, no "at least one of `nodes` / `data`" refinement:
 * `{ type: 'tree-view', bind: 'treeNodes' }` is a legal, RENDERING document
 * (`packages/components/src/renderers/__tests__/shadowed-renderer-behaviour.test.tsx`),
 * because `bind` is the FIRST source the renderer reads. A two-limb presence
 * rule would refuse it. So `bind`-only and `nodes`-only both parse below, and
 * so does a bare `{ type: 'tree-view' }` — the same document class PR #7533
 * made legal, unchanged.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening the
 * declaration fails the build on the unused directive. A green `vitest` run is
 * NOT evidence about them — type assertions are erased before it runs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { TreeViewSchema } from '../zod/data-display.zod.js';
import { BaseSchema } from '../zod/base.zod.js';
import { safeValidateSchema } from '../zod/index.zod.js';
import type { TreeNode, TreeViewSchema as TreeViewSchemaTS } from '../data-display.js';
import type { BaseSchema as BaseSchemaTS } from '../base.js';

const ROOT = resolve(__dirname, '../../../..');

/**
 * The FULL guidance string, pinned as a literal so the derived assertions below
 * cannot all drift together. The first sentence is the contract an author acts
 * on: the retired key, and the two spellings that still work.
 */
const GUIDANCE =
  'RETIRED (ADR-0049) — `data` is no longer part of TreeViewSchema; write `nodes` (or bind the tree with '
  + '`bind`). It was the second spelling of the one inline-nodes slot, read only as the last limb of '
  + '`boundData || schema.nodes || schema.data || []`, and was retired under ADR-0049 enforce-or-remove with no '
  + 'deprecation window (maintainer ruling B1, 2026-09-04). The renderer reads `bind` then `nodes` now, so an '
  + 'authored `data` would render an empty tree. Rename the key; the array is unchanged.';
const PRESCRIPTIVE = '`data` is no longer part of TreeViewSchema; write `nodes` (or bind the tree with `bind`).';

const NODES: TreeNode[] = [{ id: '1', label: 'Documents', children: [{ id: '1.1', label: 'Reports' }] }];

/** The values an author would plausibly have written on the retired key. */
const RETIRED_VALUES: readonly unknown[] = [NODES, []];

const describeOf = (schema: unknown, key: string): string | undefined =>
  ((schema as { shape: Record<string, { description?: string }> }).shape[key])?.description;

/** Flatten a union refusal so the arm-level issues are addressable by path. */
type Issue = { code: string; path: PropertyKey[]; message: string; expected?: string; errors?: Issue[][] };
const flatIssues = (issues: Issue[]): Issue[] =>
  issues.flatMap((i) => (i.code === 'invalid_union' && i.errors ? i.errors.flat().flatMap((e) => flatIssues([e])) : [i]));

/* ── the Zod half: refused BY NAME, with the guidance in the message ─────── */

describe('TreeViewSchema.data is RETIRED — the Zod half of the tombstone (objectui#6951)', () => {
  it.each(RETIRED_VALUES.map((v) => [JSON.stringify(v).slice(0, 40), v] as const))(
    'REFUSES `data: %s`, naming the retired key in the path — a well-formed array included',
    (_label, value) => {
      // The pin. Before the retirement this document parsed GREEN (`data` was
      // `z.array(TreeNodeSchema).optional()` since PR #7533). Asserting the
      // ENVELOPE — not merely `success:false` — so the pin cannot be satisfied
      // by an unrelated rejection, and asserting a WELL-FORMED array so it is
      // the key that is refused, not the elements.
      const result = TreeViewSchema.safeParse({ type: 'tree-view', data: value });
      expect(result.success, 'an authored `data` was ACCEPTED').toBe(false);
      if (result.success) return;

      const issue = result.error.issues.find((i) => i.path[0] === 'data');
      expect(issue, 'parse failed, but not on the `data` path').toBeTruthy();
      expect(issue?.code).toBe('invalid_type');
      expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
      expect(issue?.path).toEqual(['data']);
    },
  );

  it('the refusal CARRIES the guidance — it names `nodes` and `bind`, not zod\'s generic message', () => {
    const result = TreeViewSchema.safeParse({ type: 'tree-view', data: NODES });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'data');
    expect(issue?.message).not.toContain('Invalid input: expected never, received ');
    expect(issue?.message).toContain(PRESCRIPTIVE);
    expect(issue?.message).toContain('write `nodes`');
    expect(issue?.message).toBe(GUIDANCE);
    // ONE string, BOTH channels — asserted derived, so the parse message and
    // the generated-docs metadata cannot drift apart (objectui#6931).
    expect(issue?.message).toBe(describeOf(TreeViewSchema, 'data'));
  });

  it('is refused through `safeValidateSchema` too — the `AnyComponentSchema` union arm carries the tombstone', () => {
    // The entry point a validating host actually calls, and the door through
    // which `BaseSchema.data` could have let the key in: if the base member
    // won inside the union, this document would validate green.
    const result = safeValidateSchema({ type: 'tree-view', data: NODES });
    expect(result.success, 'a `tree-view` node authoring `data` validated GREEN through the union').toBe(false);
    if (result.success) return;

    const named = flatIssues(result.error.issues as Issue[]).find((i) => i.path[0] === 'data');
    expect(named, 'the union refusal does not name the `data` path').toBeTruthy();
    expect(named?.message).toBe(GUIDANCE);

    // Positive controls on the same door: the migrated document and the
    // bind-only document both validate.
    expect(safeValidateSchema({ type: 'tree-view', nodes: NODES }).success).toBe(true);
    expect(safeValidateSchema({ type: 'tree-view', bind: 'treeNodes' }).success).toBe(true);
  });

  it('BASE CONTROL: `BaseSchema` alone ACCEPTS the same document — the extended tombstone shadows `BaseSchema.data`', () => {
    // The PM's mechanism assumption, measured rather than assumed. `BaseSchema`
    // declares `data: z.any().optional()`; had the member been DELETED from
    // `TreeViewSchema`, this is the acceptance an authored `data` would have
    // inherited. The extended schema's tombstone wins over it — the two
    // readings differ on the SAME document.
    const base = BaseSchema.safeParse({ type: 'tree-view', data: NODES });
    expect(base.success).toBe(true);
    if (base.success) expect(base.data.data).toEqual(NODES);
    expect(TreeViewSchema.safeParse({ type: 'tree-view', data: NODES }).success).toBe(false);
  });

  it('keeps the key DECLARED — a tombstone, not a deletion', () => {
    // The route guard, for the trap above: remove `data` from the mirror and an
    // authored array rides `BaseSchema.data` (`z.any()`) into an empty tree.
    expect(
      Object.keys(TreeViewSchema.shape),
      'data left the mirror — an authored array now rides BaseSchema.data unvalidated',
    ).toContain('data');
    expect(describeOf(TreeViewSchema, 'data')).toContain('RETIRED (ADR-0049)');
  });
});

/* ── the inside of the boundary: what the ruling kept, measured ──────────── */

describe('the retirement narrows exactly `data` — `nodes`, `bind` and the empty document stay legal (objectui#6951 B1)', () => {
  it('`nodes`-only parses and the value SURVIVES the parse', () => {
    const result = TreeViewSchema.safeParse({ type: 'tree-view', title: 'Files', nodes: NODES });
    expect(result.success ? null : result.error.issues).toBe(null);
    if (result.success) {
      expect(result.data.nodes).toEqual(NODES);
      expect(result.data.title).toBe('Files');
    }
  });

  it('`bind`-only parses — the document a two-limb presence refinement would have refused', () => {
    // `packages/components/src/renderers/__tests__/shadowed-renderer-behaviour.test.tsx`
    // renders exactly this document from a data scope; `bind` is the FIRST
    // limb the renderer reads. The ruling rejected any `nodes`/`data`
    // presence rule for precisely this document; pinned so a later "at least
    // one of" cannot land without going red here first.
    const result = TreeViewSchema.safeParse({ type: 'tree-view', bind: 'treeNodes' });
    expect(result.success ? null : result.error.issues).toBe(null);
    if (result.success) expect(result.data.bind).toBe('treeNodes');
  });

  it('a bare `{ type: "tree-view" }` parses — `nodes` stays optional, no refinement (as ruled)', () => {
    // The document class PR #7533 made legal, unchanged: an empty tree was
    // already a legal rendering outcome (`nodes: []`), and the ruling records
    // "`nodes` stays optional; no refinement" in as many words.
    const result = TreeViewSchema.safeParse({ type: 'tree-view' });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('still REFUSES a wrong-typed `nodes` — the mirror did not stop validating', () => {
    // Counter-probe in the other direction: the schema is not `z.any()` in
    // disguise, so the green results above are readings.
    const result = TreeViewSchema.safeParse({ type: 'tree-view', nodes: 'not-an-array' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === 'nodes')).toBeTruthy();
  });

  it('control: `TreeNode.data` — the per-node payload — is still ACCEPTED and survives', () => {
    // `data` also exists on `TreeNode` (`z.any().optional()`, "custom node
    // data"). It is a different member on a different schema, untouched; the
    // pin that the retirement was located by SYMBOL, not by grep hit.
    const result = TreeViewSchema.safeParse({ type: 'tree-view', nodes: [{ id: '1', label: 'A', data: { size: 3 } }] });
    expect(result.success ? null : result.error.issues).toBe(null);
    if (result.success) expect(result.data.nodes?.[0]?.data).toEqual({ size: 3 });
  });

  it('an UNDECLARED key still rides `.passthrough()` — the DELETED row, measured live', () => {
    // A key the mirror does not declare is neither refused nor stripped, it is
    // KEPT. `data` is not in this class only because it is DECLARED as a
    // tombstone; the base member would otherwise have caught it (base control).
    const result = TreeViewSchema.safeParse({ type: 'tree-view', nodes: NODES, notAKeyAtAll: 'anything' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveProperty('notAKeyAtAll', 'anything');
  });
});

/* ── the corpus: no shipped fixture authors the retired spelling ─────────── */

/** Every `tree-view` node (an object whose OWN `type` is `"tree-view"`) in a parsed JSON document. */
function* treeViewNodes(node: unknown, path: string): Generator<[string, Record<string, unknown>]> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* treeViewNodes(node[i], `${path}[${i}]`);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'tree-view') yield [path, obj];
  for (const [k, v] of Object.entries(obj)) yield* treeViewNodes(v, `${path}.${k}`);
}

function* jsonFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* jsonFiles(full);
    else if (entry.endsWith('.json')) yield full;
  }
}

describe('no shipped JSON fixture authors `tree-view.data` any more (objectui#6951) — tree-scoped', () => {
  // Tree-scoped on purpose: a file-scoped pin sees only the files its author
  // knew about. At the retirement the walk found five `tree-view` nodes in the
  // catalog (four entries + the nested tree in
  // `components-complex-resizable/editor-interface.json`, all on `nodes`) and
  // one in `packages/types/examples/data-display-examples.json` (rewritten from
  // `data` to `nodes`) — six in all. Each is parsed per node, because `SchemaNodeSchema`
  // does not descend into `AnyComponentSchema`.
  const CATALOG = resolve(ROOT, 'examples/schema-catalog/src/schemas');
  const TYPES_EXAMPLES = resolve(ROOT, 'packages/types/examples');

  it('every `tree-view` node in the catalog and the types examples spells `nodes` (or nothing inline), and parses green', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const dir of [CATALOG, TYPES_EXAMPLES]) {
      for (const file of jsonFiles(dir)) {
        const doc = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        for (const [path, node] of treeViewNodes(doc, '$')) {
          seen++;
          if ('data' in node) offenders.push(`${file.slice(ROOT.length + 1)} ${path}`);
          const result = TreeViewSchema.safeParse(node);
          if (!result.success) offenders.push(`${file.slice(ROOT.length + 1)} ${path}: ${JSON.stringify(result.error.issues)}`);
        }
      }
    }
    // Non-vacuity: six at the retirement; a walk that finds none is broken.
    expect(seen).toBeGreaterThanOrEqual(6);
    expect(offenders).toEqual([]);
  });
});

/* ── the renderer half: the retired key is no longer READ ────────────────── */

describe('the `tree-view` renderer no longer reads `schema.data` (objectui#6951, enforce-or-remove)', () => {
  it('the read set, off disk: `bind` first, `nodes` second, nothing third', () => {
    // Read off disk so a renderer-side re-widening cannot pass while the
    // schema faces still refuse.
    const src = readFileSync(resolve(ROOT, 'packages/components/src/renderers/data-display/tree-view.tsx'), 'utf8');
    expect(src).toContain('const rawNodes = boundData || schema.nodes || [];');
    expect(src.match(/schema\.data\b/g)).toBeNull();
    expect(src.indexOf('useDataScope(schema.bind)')).toBeLessThan(src.indexOf('schema.nodes'));
  });
});

/* ── the TS half: the `tsc` channel ──────────────────────────────────────── */

describe('TreeViewSchema.data is RETIRED — the TS half of the tombstone (objectui#6951)', () => {
  it('refuses the retired key at compile time', () => {
    // On the pre-fix tree `data` is `TreeNode[] | undefined`, so the assignment
    // is LEGAL, the directive is unused, and `tsc` fails the build with TS2578
    // naming the key — red before the fix in `type-check`, not in vitest.

    // @ts-expect-error — `data` is RETIRED (objectui#6951): declared `?: never`, so no value is authorable.
    const retired: TreeViewSchemaTS['data'] = NODES;

    // Counter-probes on the same surface: the live siblings still accept their
    // values, so the directive pins the KEY's retirement, not a blanket
    // narrowing of the interface.
    const nodes: TreeViewSchemaTS['nodes'] = NODES;
    const bind: TreeViewSchemaTS['bind'] = 'treeNodes';

    expect([retired, nodes, bind]).toHaveLength(3);
  });

  it('refuses the retired key in the form authors actually write — and shadows the inherited `BaseSchema.data?: any`', () => {
    // The leg that proves the tombstone beats the escape hatches on the TS
    // face: `BaseSchema` carries `data?: any` (and carried `[key: string]: any`
    // until objectui#8347). A declared `never` member wins over the inherited
    // `any` and over an index signature; if either won, `data` would widen back and the directive
    // would go unused (TS2578).
    const retiredDocument: TreeViewSchemaTS = {
      type: 'tree-view',
      // @ts-expect-error — `data` is RETIRED (objectui#6951); write `nodes` (or bind the tree with `bind`).
      data: NODES,
    };

    // The migrated documents — `nodes`, and `bind`-only — still type-check.
    const nodesDocument: TreeViewSchemaTS = { type: 'tree-view', title: 'Files', nodes: NODES };
    const bindDocument: TreeViewSchemaTS = { type: 'tree-view', bind: 'treeNodes' };

    // BASE CONTROL on the TS face: the same literal IS a legal `BaseSchema` —
    // the acceptance a deleted member would have fallen through to.
    const baseDocument: BaseSchemaTS = { type: 'tree-view', data: NODES };

    expect([retiredDocument, nodesDocument, bindDocument, baseDocument]).toHaveLength(4);
  });

  it('refuses it through a WIDENED value too — the half a deletion would have missed', () => {
    // Excess-property checking only reaches a FRESH literal (objectui#7654
    // measured the contrast); the declared `never` makes the assignment itself
    // ill-typed, so freshness stops mattering.
    const raw = { type: 'tree-view' as const, data: NODES };
    // @ts-expect-error — `data` is RETIRED (objectui#6951), reached through a non-fresh value.
    const document: TreeViewSchemaTS = raw;
    expect(document.type).toBe('tree-view');
  });

  it('control: `TreeNode.data?: any` still type-checks — retired by symbol, not by grep', () => {
    const node: TreeNode = { id: '1', label: 'A', data: { size: 3 } };
    expect(node.data).toEqual({ size: 3 });
  });
});
