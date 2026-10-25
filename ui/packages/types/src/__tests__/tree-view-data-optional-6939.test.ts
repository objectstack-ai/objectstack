/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6939, the `tree-view` group — the VALIDATOR half. The render half
 * is `examples/schema-catalog/test/tree-view-nodes-mirror-6939.test.tsx`.
 *
 * ## The defect
 *
 * `TreeViewSchema` REQUIRED `data`, the limb the renderer reads THIRD:
 *
 *     const rawNodes = boundData || schema.nodes || schema.data || [];
 *     // packages/components/src/renderers/data-display/tree-view.tsx:105
 *
 * The registration's own `inputs` and `defaultProps` spell it `nodes`, and the
 * four `components-data-display-tree-view/*` catalog entries ARE those
 * `defaultProps` — so every one of them was refused by `safeValidateSchema`
 * (`: Invalid input`, the union's top-level issue) while drawing correctly.
 * Measured on `origin/main` at `fe4e7a9e8`, mirror untouched: all four refused,
 * and all four rendered byte-identically under the `data` spelling.
 *
 * ## What objectui#6150 did and did NOT do
 *
 * #6150 DECLARED `nodes` and `title` — both faces, both keys, and its pins in
 * `undeclared-but-consumed-keys-6150.test.ts` still hold. It deliberately
 * stopped there and wrote so: relaxing `data` is an accept-set change and a
 * separate ruling. This is that change; `nodes` and `title` are untouched here.
 *
 * ## What objectui#6951 (maintainer ruling B1, 2026-09-04) did to this pin
 *
 * `data` was RETIRED outright — `?: never` on the TS face, `retirementTombstone()`
 * on the mirror, and the renderer's read is now `boundData || schema.nodes || []`.
 * The relaxation this file records is still history worth keeping: `nodes` stays
 * optional, a document with no inline source stays legal (no refinement, as ruled),
 * and the "deleted member falls through to `BaseSchema.data`" measurement is
 * exactly why the retirement is a tombstone and not a deletion. The pins below
 * that asserted `data` ACCEPTED are flipped to refusal in place; the refusal
 * envelope itself is pinned in `tree-view-data-retired-6951.test.ts`.
 *
 * ## Why `data` stays DECLARED instead of being deleted
 *
 * Deleting the member is the intuitive reading of "the renderer prefers
 * `nodes`", and it is the wrong one — measured, not assumed. `BaseSchema`
 * already declares `data` (`z.any().optional()`; `data?: any` on the TS face),
 * so a `TreeViewSchema` without its own `data` member does not REJECT the key:
 * it admits it unvalidated, while the renderer goes on reading it. Enforcement
 * would be traded away for nothing. `assertion data is still VALIDATED` below
 * is the pin that makes the difference visible — it is the assertion that turns
 * green-to-red if a later sweep deletes the member.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TreeViewSchema } from '../zod/data-display.zod';
import { BaseSchema } from '../zod/base.zod';
import type { TreeNode, TreeViewSchema as TsTreeViewSchema } from '../data-display';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const READER = 'packages/components/src/renderers/data-display/tree-view.tsx';
const READ_TEXT = 'boundData || schema.nodes || []';

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/**
 * `data` is OPTIONAL and still `TreeNode[]` — one pin, biting in both
 * directions that matter:
 *
 *   - required again  -> `TreeNode[]` is not `TreeNode[] | undefined`  -> red
 *   - member DELETED  -> resolves to the INHERITED `BaseSchema.data?: any`
 *                        (`base.ts:183`) — `any`, and `Equal< any, … >` is
 *                        false                                         -> red
 *
 * ⚠️ The second limb is NOT the index signature, and the difference matters
 * because it is the whole reason this card keeps the member instead of deleting
 * it. `BaseSchema` carries `data?: any` (and carried `[key: string]: any` too,
 * until objectui#8347), and a declared member — inherited or not — wins over
 * an index signature. Measured: strip the index signature with
 * the homomorphic `keyof`-remap that `zod-mirror-parity.test.ts` uses, and
 * `['data']` is STILL `any`, while a key reachable only through the index
 * signature stops resolving at all. So deletion does not fall through to an
 * open bag; it lands on a declared, untyped inherited member — which is
 * exactly what the file header, the TS-face doc comment and the mirror's
 * `.describe()` all say, and what this comment used to contradict.
 */
export type _TreeDataIsRetired =
  Expect< Equal< TsTreeViewSchema['data'], undefined > >;
// ^ objectui#6951: `data?: never` reads as `undefined`. The second limb above
//   still bites — a DELETED member resolves to the inherited `any` and this
//   equality goes red — and so does the first: `TreeNode[] | undefined` (the
//   pre-retirement declaration) is not `undefined`.

/** `nodes` and `title` are objectui#6150's and are unchanged by this card. */
export type _TreeNodesStillTreeNodes =
  Expect< Equal< NonNullable< TsTreeViewSchema['nodes'] >, TreeNode[] > >;
export type _TreeTitleStillString =
  Expect< Equal< NonNullable< TsTreeViewSchema['title'] >, string > >;

/**
 * The document the four catalog entries author. It did not compile before this
 * card — `data` was a required member — and an index signature cannot rescue a
 * MISSING required key, so this annotation is a real compile-time pin.
 */
export const NODES_ONLY_DOCUMENT: TsTreeViewSchema = {
  type: 'tree-view',
  title: 'File Explorer',
  nodes: [{ id: '1', label: 'Documents' }],
};

/* ── Runtime pins ─────────────────────────────────────────────────────────── */

const ROOT = { type: 'tree-view' } as const;
const NODES = [{ id: '1', label: 'Documents' }];
/** An undeclared key, so "refused" below can be told from "strict object". */
const SENTINEL = 'undeclaredTreeKey6939';

describe('objectui#6939 — a `nodes`-only tree-view is a legal document', () => {
  it('the spelling the renderer reads FIRST now parses on its own', () => {
    const r = TreeViewSchema.safeParse({ ...ROOT, nodes: NODES });
    expect(r.success, JSON.stringify(r.success ? [] : r.error.issues)).toBe(true);
  });

  it('…and the value SURVIVES the parse, rather than being stripped', () => {
    const r = TreeViewSchema.safeParse({ ...ROOT, title: 'File Explorer', nodes: NODES });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.nodes).toEqual(NODES);
      expect(r.data.title).toBe('File Explorer');
    }
  });

  it('every `data` document is now REFUSED by name — objectui#6951 retired the spelling', () => {
    // Flipped from "the accept set only WIDENED": PR #7533 relaxed `data` and
    // objectui#6951 then retired it. `packages/types/examples/data-display-examples.json`
    // now authors its tree-view on `nodes`. The refusal lands on the `data`
    // path with the guidance; the envelope is pinned in the retirement file.
    for (const doc of [{ ...ROOT, data: NODES }, { ...ROOT, data: NODES, nodes: NODES }, { ...ROOT, data: [] }]) {
      const r = TreeViewSchema.safeParse(doc);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('data');
    }
  });

  it('a tree-view with NO data source at all is legal, and that admits nothing new', () => {
    // Stated rather than hidden: this is the one document class the relaxation
    // adds. It is not a new rendering outcome — `{ data: [] }` was ALREADY
    // legal and already drew the same empty tree, so no refinement of the
    // `at least one of` shape (the one objectui#6939's object-map / object-gantt
    // group added) would be buying a guarantee here. It would only forbid a
    // spelling of the empty state that the contract already permits.
    expect(TreeViewSchema.safeParse(ROOT).success).toBe(true);
  });
});

describe('objectui#6939 — `data` is still DECLARED, so it is still VALIDATED', () => {
  it('a wrong-typed `data` is refused AT the key', () => {
    // ⛔ This is the assertion that reddens if a later sweep DELETES the member
    // instead of relaxing it. Deleting is not a rejection: `BaseSchema.data` is
    // `z.any().optional()`, so the key would be admitted unvalidated.
    const r = TreeViewSchema.safeParse({ ...ROOT, data: 'not-an-array' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('data');
  });

  it('a well-formed `data` array is refused at the KEY, not at an element — the tombstone, not element validation', () => {
    // Pre-retirement this pinned `data.0.id` (element-level enforcement). The
    // tombstone refuses the key itself, so the path is `data` and the message
    // names the spelling to write instead.
    const r = TreeViewSchema.safeParse({ ...ROOT, data: [{ label: 'no id' }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.join('.') === 'data');
      expect(issue).toBeTruthy();
      expect(issue?.message).toContain('write `nodes`');
    }
  });

  it('control: `BaseSchema` alone would have admitted both of those', () => {
    // The measurement behind "kept declared rather than deleted", made visible
    // rather than asserted in prose: the base object takes the very values the
    // member above refuses. Delete the member and the two refusals become these
    // two acceptances.
    expect(BaseSchema.safeParse({ type: 'tree-view', data: 'not-an-array' }).success).toBe(true);
    expect(BaseSchema.safeParse({ type: 'tree-view', data: [{ label: 'no id' }] }).success).toBe(true);
  });

  it('control: an UNDECLARED key is still admitted unexamined, exactly as before', () => {
    // `BaseSchema` is `.passthrough()`, so the refusals above measure the
    // declaration and not the object's strictness. This is also the proof that
    // the unknown-key policy did not move with the optionality.
    //
    // ⚠️ The carrier is `data`-bearing ON PURPOSE, so it is a legal document
    // with or without this card and this control can only fail for its own
    // reason. Measured: written over a `nodes`-only carrier it reddens under
    // the ablation below — not because passthrough moved, but because the
    // pre-repair mirror refuses the carrier itself. A control that fails for
    // the change it is controlling FOR is not a control.
    // objectui#6951: the carrier moved from `data: []` to `nodes: []` — the
    // same reasoning, the other way round: `data` is now the retired spelling,
    // so a `data`-bearing carrier would redden for the retirement, not for
    // passthrough. `nodes: []` is legal before and after.
    const r = TreeViewSchema.safeParse({ ...ROOT, nodes: [], [SENTINEL]: 'not-an-array' });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>)[SENTINEL]).toBe('not-an-array');
  });

  it('`nodes` keeps the enforcement objectui#6150 gave it', () => {
    expect(TreeViewSchema.safeParse({ ...ROOT, nodes: 'not-an-array' }).success).toBe(false);
    expect(TreeViewSchema.safeParse({ ...ROOT, title: 42 }).success).toBe(false);
  });
});

describe('objectui#6951 — the renderer no longer reads the retired limb', () => {
  it('the read is `boundData || schema.nodes || []` — `bind` first, `nodes` second, nothing third', () => {
    // Enforce-or-remove: a retired key must stop being READ as well as declared.
    // Line numbers drift and stay in prose; the READ is the fact.
    const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
    expect(src, `${READER} does not read \`${READ_TEXT}\``).toContain(READ_TEXT);
    expect(src.match(/schema\.data\b/g)).toBeNull();
  });

  it('and `bind` is still read ahead of `nodes` — the order the no-refinement ruling rests on', () => {
    const src = readFileSync(join(REPO_ROOT, READER), 'utf8');
    expect(src.indexOf('useDataScope(schema.bind)')).toBeLessThan(src.indexOf('schema.nodes'));
  });
});
