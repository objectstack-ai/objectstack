/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `EmptySchema.action` is DECLARED, MIRRORED, ADVERTISED — and enforced exactly
 * as declared (objectui#7105).
 *
 * ## What was wrong
 *
 * `empty` has rendered an `action` node, and `content/docs/components/feedback/
 * empty.mdx` has documented it, for a long time. Four surfaces disagreed:
 *
 *   * `EmptySchema` (TypeScript) declared `type` / `title` / `description` /
 *     `icon` and no `action`;
 *   * `feedback.zod.ts`'s mirror declared the same four;
 *   * the renderer's `registrationMeta.inputs` listed `title` / `description` /
 *     `className`, so the designer could not offer the key either;
 *   * only the docs row said the capability existed.
 *
 * The read compiled because `BaseSchema` ended in `[key: string]: any`, and the
 * renderer spelled it `(schema as any).action` — which is also why
 * objectui#6150's census, scanning for `schema.KEY`, could not see this reader.
 *
 * And the slot was NARROWER than a node slot: the renderer required
 * `typeof actionSchema === 'object'`, so a bare string `action` was silently
 * DROPPED rather than rendered.
 *
 * ## What is pinned here, and why each half is needed
 *
 * Ruled (maintainer, decision batch #69, 2026-09-07): declare `action?:
 * SchemaNode`, mirror it, and RELAX the renderer's guard so declared equals
 * enforced. The ruling names the pin — the shipped demo must compile against the
 * declared type AND a string `action` must render. A pin that proved only the
 * type would be half a pin: it would hold with the object-only guard still in
 * place, which is the exact state this card exists to end.
 *
 * ## Non-vacuity — every assertion below fails on the pre-change tree
 *
 *   * the `Equal` assertion: `EmptySchema['action']` resolved to `any` through
 *     the index signature, and `Equal<any, SchemaNode>` is false;
 *   * `shape` membership: asserted on the mirror's OWN shape, never on parse
 *     acceptance. `BaseSchema` is `.passthrough()` and `.extend()` carries that
 *     through, so `action` ALREADY parsed green as an unexamined key — under
 *     passthrough, acceptance cannot tell "declared" from "admitted"
 *     (the form `undeclared-but-consumed-keys-6150.test.ts` established);
 *   * the value control: `{ label: 'x' }` with no `type` was admitted by
 *     passthrough before and is refused by `SchemaNodeSchema` now. This is the
 *     VALUE half — key membership above and value judgement here are two
 *     different facts and are asserted separately;
 *   * the string-renders leg: the behaviour change itself;
 *   * the `inputs` leg: `action` was absent from the registration.
 *
 * The demo is read OFF DISK rather than hand-copied, and the literal the
 * compile-time assertion is written against is checked byte-for-byte against
 * it — so the two cannot drift apart silently.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律):
 * registering them is an unbounded module load and must not be billed to a
 * bounded hook timeout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { EmptySchema as EmptyMirror } from '@object-ui/types/zod';
import type { ButtonSchema, EmptySchema, SchemaNode } from '@object-ui/types';
import '../renderers';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const DEMO_PATH = join(
  REPO_ROOT,
  'examples', 'schema-catalog', 'src', 'schemas',
  'components-feedback-empty', 'with-action-button.json',
);

/* ── Type-level helpers (invariant equality, house form) ─────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/**
 * The declared type of the key, pinned INVARIANTLY.
 *
 * `SchemaNode` already carries `undefined`, so the optional marker adds no arm
 * and the two spellings are the same type.
 */
type _ActionIsSchemaNode = Expect< Equal< EmptySchema['action'], SchemaNode > >;

/**
 * The shipped demo, as a literal the compiler checks against the declared type.
 * The first test asserts it is byte-identical to the file the docs page renders.
 */
const DEMO_ACTION: ButtonSchema = {
  type: 'button',
  label: 'Create Project',
  variant: 'default',
};
// `DEMO_ACTION` is typed as the `button` node it is (objectui#11347): the slot is
// `SchemaNode`, and since objectui#8347 removed `BaseSchema`'s index signature
// a literal checked against it may author only `BaseSchema`'s own keys.
const DEMO = {
  type: 'empty',
  icon: 'folder-plus',
  title: 'No projects yet',
  description: 'Get started by creating your first project',
  action: DEMO_ACTION,
} satisfies EmptySchema;

const readDemo = (): unknown => JSON.parse(readFileSync(DEMO_PATH, 'utf8'));

describe('EmptySchema.action is declared, mirrored and advertised (objectui#7105)', () => {
  it('the `with-action-button` demo the docs page renders IS the literal typed above', () => {
    // Closes the hand-copy hole: `DEMO satisfies EmptySchema` is a compile-time
    // fact about a literal, and this is what ties that literal to the shipped
    // file. If the demo changes, this fails rather than the pin going stale.
    expect(readDemo()).toEqual(DEMO);
  });

  it('the TypeScript face declares `action` (not just admits it via the index signature)', () => {
    // The invariant `Equal` above is the assertion; this keeps a runtime
    // failure message on the same fact. `any` would satisfy neither.
    const declaresAction: Equal< EmptySchema['action'], SchemaNode > = true;
    expect(declaresAction).toBe(true);
  });

  it('the zod mirror DECLARES `action` in its own shape', () => {
    expect(Object.keys(EmptyMirror.shape)).toContain('action');
  });

  it('the mirror accepts the shipped demo', () => {
    const result = EmptyMirror.safeParse(readDemo());
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('the mirror accepts a bare string action — the arm the guard used to drop', () => {
    expect(EmptyMirror.safeParse({ type: 'empty', action: 'Nothing here yet' }).success).toBe(true);
  });

  it('the mirror now JUDGES the value: a node object with no `type` is refused', () => {
    // Value control. Before the declaration this parsed green under
    // `.passthrough()` — admitted unexamined. `{ label, onClick }` is
    // `ToastSchema.action`'s shape, a DIFFERENT interface; authoring it here is
    // precisely the confusion an undeclared key invites.
    expect(EmptyMirror.safeParse({ type: 'empty', action: { label: 'Create' } }).success).toBe(false);
  });

  it('the designer surface advertises `action` as a slot', () => {
    const input = ComponentRegistry.getMeta('empty')?.inputs?.find(i => i.name === 'action');
    expect(input, '`empty` registration does not declare an `action` input').toBeDefined();
    expect(input?.type).toBe('slot');
  });
});

describe('the renderer enforces exactly what is declared (objectui#7105)', () => {
  it('renders the action node of the shipped demo', () => {
    const { container } = render(<SchemaRenderer schema={readDemo() as never} />);
    expect(container.textContent).toContain('Create Project');
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('renders a BARE STRING action as text instead of dropping it', () => {
    // The behaviour change. Under the old `typeof actionSchema === 'object'`
    // guard this text never reached the DOM.
    const { container } = render(
      <SchemaRenderer schema={{ type: 'empty', title: 'Nothing', action: 'Ask an admin for access' } as never} />,
    );
    expect(container.textContent).toContain('Ask an admin for access');
  });

  it('renders no action node when the key is absent', () => {
    const { container } = render(<SchemaRenderer schema={{ type: 'empty', title: 'Nothing' } as never} />);
    expect(container.textContent).toBe('Nothing');
    expect(container.querySelector('button')).toBeNull();
  });
});
