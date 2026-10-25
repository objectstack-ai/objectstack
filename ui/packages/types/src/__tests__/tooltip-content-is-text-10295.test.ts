/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10295 — `TooltipSchema.content` is TEXT on both faces (the
 * objectui#7759 group B residue).
 *
 * `@objectstack/spec` declares no tooltip node, so the key is objectui's own and
 * follows its read site (ruling 5617465269 rule 2). That read,
 * `packages/components/src/renderers/overlay/tooltip.tsx`, places
 * `schema.content` RAW in a React child position — only `children` goes through
 * `renderChildren` — so a node authored there crashed the tooltip with "Objects
 * are not valid as a React child". objectui#10280 had already refused the list
 * arm on that ground; this card refuses the single-node arm too, and points the
 * author at `children`, where rich content renders.
 *
 * The type-level legs are read by `tsc -p tsconfig.test.json` (this package's
 * `type-check`), the runtime legs by vitest. Each reddens when its face is
 * widened back to `string | SchemaNode`.
 */

import { describe, expect, it } from 'vitest';

import type { TooltipSchema } from '../overlay';
import { TooltipSchema as TooltipZod } from '../zod/overlay.zod.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const NODE = { type: 'text', content: 'Rich' } as const;

const issuesAt = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; code: string; message: string }[] } }, key: string) =>
  (result.success ? [] : result.error?.issues ?? []).filter((issue) => issue.path.join('.') === key);

/* ────────────────────────────────────────────────────────────────────────────
 * TypeScript face
 * ───────────────────────────────────────────────────────────────────────── */

export type _TooltipContentIsText = Expect<Equal<TooltipSchema['content'], string | undefined>>;

describe('objectui#10295 — the declaration types `content` as text', () => {
  it('refuses a node at `content` and accepts it under `children`', () => {
    // @ts-expect-error objectui#10295 — `content` is text; a node belongs under `children`
    const refused: TooltipSchema = { type: 'tooltip', content: NODE };
    const accepted: TooltipSchema = { type: 'tooltip', content: 'Helpful information', children: NODE };

    expect(refused.type).toBe('tooltip');
    expect(accepted.content).toBe('Helpful information');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * zod mirror
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#10295 — the mirror refuses a non-text `content` by name', () => {
  it.each([
    ['a single node', NODE],
    ['a list of nodes', [NODE, NODE]],
    ['an inline locale map', { en: 'Help', fr: 'Aide' }],
  ] as const)('refuses %s at `content`, naming `children`', (_label, content) => {
    const result = TooltipZod.safeParse({ type: 'tooltip', content });
    const issues = issuesAt(result, 'content');

    expect(result.success).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('invalid_type');
    // The first sentence is the contract an author reads; zod's generic
    // `expected string` names neither the reason nor the working spelling.
    expect(issues[0]?.message.startsWith('A tooltip\'s `content` is TEXT only (objectui#10295)')).toBe(true);
    expect(issues[0]?.message).toContain('under `children`');
  });

  it('`content` stays DECLARED, so a node is refused rather than kept by `.passthrough()`', () => {
    expect(Object.keys(TooltipZod.shape)).toContain('content');
  });

  it('POSITIVE CONTROLS — text at `content`, and a node or a list under `children`, parse green', () => {
    expect(TooltipZod.safeParse({ type: 'tooltip', content: 'Helpful information' }).success).toBe(true);
    expect(TooltipZod.safeParse({ type: 'tooltip', children: NODE }).success).toBe(true);
    expect(TooltipZod.safeParse({ type: 'tooltip', children: [NODE, NODE] }).success).toBe(true);
  });
});
