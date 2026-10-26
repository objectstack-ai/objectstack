/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7804 — the `tree-view` arm declares the ONE handler key its registered
 * renderer reads, as an objectui#6124 RUNTIME SLOT.
 *
 * `BaseSchema` is `.passthrough()`, so a key no arm declares is not refused: it
 * stops being judged and the value is KEPT. `TreeViewSchema.onNodeClick` sat in
 * exactly that state while the registered `tree-view` renderer INVOKED it, so an
 * authored `{ "type": "tree-view", "onNodeClick": { "action": "toast" } }` parsed
 * GREEN and that object was handed to a call site expecting a function.
 *
 * ## What this file pins that the ledgers next door cannot
 *
 * 1. **The disposition was MEASURED per key, not applied per group.** This arm
 *    carries all three dispositions at once — `onNodeClick` as `'runtime-slot'`
 *    and its two siblings `onSelectChange` / `onExpandChange` as `'retired'` —
 *    so the two guidance texts are asserted to DIFFER on the same schema. A slice
 *    that copied a sibling's disposition would still refuse the key, still drain
 *    the ledger row and still be green everywhere else; this is where it is not.
 * 2. **The registration is not an ALIAS.** Thirteen of the fifteen rows standing
 *    on this card when this slice was taken are the objectui#9573 shape: the
 *    registration carries `skipFallback: true`, so it never claims the bare type
 *    key, while the census keys a registration by its RAW TYPE STRING and judges
 *    the read against an arm minted for a different component. Declaring the key
 *    on such an arm publishes a handler on the wrong component. `tree-view` is
 *    registered `{ namespace: 'ui' }` with NO `skipFallback`, so this arm really
 *    is the contract for what renders under `tree-view` — the fact that makes the
 *    declaration safe, checked off disk rather than asserted in prose.
 *
 * ⛔ What this file does NOT assert: that the key is unreachable. It is a RUNTIME
 * SLOT. A TypeScript host that builds this node still supplies the function
 * through `TreeViewSchema.onNodeClick` on the declaration face; what is refused is
 * AUTHORING one as JSON, which could only ever hand a call site a plain object.
 *
 * ⚠️ Unlike this card's `list-view` slice there is no precedence type here, and
 * that is a reading rather than an omission: `../data-display.ts#TreeViewSchema`
 * is a hand-written `interface … extends BaseSchema`, not `z.input` of this
 * mirror, so a refusal arm cannot AND its callable twin down to `undefined`. The
 * type-level pin below is where that reading fails if the face is ever rebased
 * onto the mirror.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { TreeViewSchema as TreeViewMirror } from '../zod/data-display.zod.js';
import type { TreeNode, TreeViewSchema } from '../data-display.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const RENDERER = 'packages/components/src/renderers/data-display/tree-view.tsx';

/** The one row this slice drained from `KNOWN_UNDECLARED_READS`. */
const DECLARED_SLOT = 'onNodeClick';

/** The two `'retired'` arms already on this schema — the DISPOSITION control. */
const RETIRED_SIBLINGS = ['onSelectChange', 'onExpandChange'] as const;

/**
 * A handler key this arm still does not declare — the LIVE CONTROL.
 *
 * It is the exact state `onNodeClick` was in before this slice: undeclared, so
 * `BaseSchema.passthrough()` does not refuse it — it stops judging it and KEEPS
 * the value. Asserting it is still accepted in the same pass is what makes the
 * refusal below a reading rather than a claim about a parser that might simply be
 * rejecting everything.
 *
 * ⚠️ If a later slice declares this key, the control dies silently — so the first
 * assertion below fails loudly instead, telling the next author to pick a new one
 * rather than lose the control.
 */
const STILL_UNDECLARED = 'onNodeDoubleClick';

/** A minimal node the arm accepts, so a failure can only come from the key under test. */
function node(extra: Record<string, unknown>) {
  return { type: 'tree-view', nodes: [], ...extra };
}

/** The authored value shape that motivates the whole card: an action object, not a function. */
const AUTHORED = { action: 'toast' } as const;

const shapeKeys = (): string[] =>
  Object.keys((TreeViewMirror as unknown as { shape: Record<string, unknown> }).shape);

const describeOf = (key: string): string => {
  const member = (TreeViewMirror as unknown as {
    shape: Record<string, { description?: string }>;
  }).shape[key];
  return member?.description ?? '';
};

describe('objectui#7804 — the `tree-view` arm refuses `onNodeClick` BY NAME', () => {
  it('the control key is genuinely still undeclared on this arm', () => {
    expect(shapeKeys()).not.toContain(STILL_UNDECLARED);
  });

  it('the key is a MEMBER of the mirror shape — membership, not acceptance', () => {
    // Under `.passthrough()` a parse result cannot tell "declared" from "admitted
    // unexamined", which is the whole reason this card exists. Membership can.
    expect(shapeKeys()).toContain(DECLARED_SLOT);
  });

  it('refuses the authored action object at its own path, with the #5099 `custom` code', () => {
    const result = TreeViewMirror.safeParse(node({ [DECLARED_SLOT]: AUTHORED }));

    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    const own = issues.filter((issue) => issue.path.length === 1 && issue.path[0] === DECLARED_SLOT);
    expect(own).toHaveLength(1);
    expect(own[0].code).toBe('custom');
    // The message names the key, so the issue is addressed even when it is read
    // without its path — the one contract `handlerKeyRefusal` composes.
    expect(own[0].message).toContain(`\`${DECLARED_SLOT}\``);
  });

  it('a LIVE FUNCTION is refused too — the refusal is about the key, not the value', () => {
    const result = TreeViewMirror.safeParse(node({ [DECLARED_SLOT]: () => undefined }));
    expect(result.success).toBe(false);
  });

  it('control: the same document WITHOUT the key parses green', () => {
    expect(TreeViewMirror.safeParse(node({})).success).toBe(true);
  });

  it('⭐ CONTROL — the still-undeclared key is ACCEPTED and its value is KEPT', () => {
    const result = TreeViewMirror.safeParse(node({ [STILL_UNDECLARED]: AUTHORED }));

    expect(result.success).toBe(true);
    // Not merely accepted: the passthrough KEEPS it, which is what carried an
    // authored object all the way to a call site expecting a function.
    const parsed = (result.success ? result.data : {}) as Record<string, unknown>;
    expect(parsed[STILL_UNDECLARED]).toEqual(AUTHORED);
  });
});

describe('objectui#7804 — the disposition was measured per key, on this one arm', () => {
  it('`onNodeClick` says RUNTIME SLOT and its two siblings say RETIRED', () => {
    // ⭐ The assertion this slice's judgement rests on. `'retired'` publishes
    // "no renderer reads this key, so nothing could ever run it" — true for the
    // two siblings, and flatly false for `onNodeClick`, which is gated on and
    // CALLED. A slice that read the disposition off the group would be green
    // everywhere else and would publish that false sentence to the author.
    expect(describeOf(DECLARED_SLOT)).toContain('RUNTIME SLOT');
    expect(describeOf(DECLARED_SLOT)).not.toContain('RETIRED');
    for (const sibling of RETIRED_SIBLINGS) {
      expect(describeOf(sibling), sibling).toContain('RETIRED');
      expect(describeOf(sibling), sibling).not.toContain('RUNTIME SLOT');
    }
  });

  it('the renderer still gates on the key and CALLS it — the fact the slot records', () => {
    const src = readFileSync(join(REPO_ROOT, RENDERER), 'utf8');
    expect(src, `${RENDERER} no longer gates on the key`).toContain('if (schema.onNodeClick)');
    expect(src, `${RENDERER} no longer calls the key`).toContain('schema.onNodeClick(node)');
  });
});

describe('objectui#7804 — this registration is NOT the objectui#9573 alias shape', () => {
  it('`tree-view` is registered without `skipFallback`, so this arm owns the bare key', () => {
    const src = readFileSync(join(REPO_ROOT, RENDERER), 'utf8');
    // The registration this file's renderer makes, read as one call: it names the
    // `ui` namespace and NOTHING in the file opts out of the bare-name fallback.
    // A `skipFallback: true` here would mean the authored type is `ui:tree-view`
    // and the bare `tree-view` key belongs to someone else — the state that makes
    // thirteen of this card's remaining rows undrainable as written.
    expect(src).toContain("ComponentRegistry.register('tree-view',");
    expect(src).toContain("namespace: 'ui'");
    expect(src, 'this renderer now skips the bare-name fallback — the arm may no longer be its contract')
      .not.toContain('skipFallback');
  });
});

/**
 * ⛔ TYPE-LEVEL PIN — this fails at `tsc`, not at runtime.
 *
 * The declaration face keeps the CALLABLE twin: that is what `'runtime-slot'`
 * promises, and it is what a programmatic host supplies. It reads as a call
 * signature taking the clicked node, never as a value shape.
 *
 * ⚠️ It is also the regression pin for the `list-view` hazard NOT applying here.
 * If `TreeViewSchema` is ever rebased onto `z.input` of the mirror, this member
 * collapses to `undefined` — assignable to every optional callback parameter the
 * reads hand it, so nothing else in this repository would go red.
 */
const TYPE_PINS = {
  onNodeClick: ((n: TreeNode) => {
    void n;
  }) satisfies NonNullable<TreeViewSchema['onNodeClick']>,
} as const;

describe('objectui#7804 — the TypeScript face survives the declaration', () => {
  it('compiles: the type-level pin above is the check, and tsc is what runs it', () => {
    expect(typeof TYPE_PINS).toBe('object');
  });
});
