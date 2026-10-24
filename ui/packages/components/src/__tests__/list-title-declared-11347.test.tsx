/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `list` draws an authored `title`, and `ListSchema` declares it (objectui#11347).
 *
 * The renderer has read `schema.title` all along, drawing it as a heading above
 * the list, and the `list` registration publishes it as an input. Until
 * objectui#11347 no declaration carried it, so it survived only on
 * `BaseSchema`'s index signature, which objectui#8347 removed. The installed
 * `@objectstack/spec` has no row for `list`, and a published producer authors
 * the key: the `skills/objectui` expressions guide teaches
 * `{ "type": "list", "title": "Team", "ordered": true, ... }`. So the key is
 * declared where the renderer and the registry already honour it, rather than
 * retired.
 *
 * Three readers pin it:
 *   - the runtime: the guide's literal, rendered through the real
 *     `SchemaRenderer`, draws its title, and a node without one draws none;
 *   - the zod mirror: a string `title` parses, and a number is refused at `title`;
 *   - the compiler: `tsc -p tsconfig.test.json` reads the typed literal and
 *     the `@ts-expect-error` line below. Vitest cannot see either.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { ListSchema as ListMirror } from '@object-ui/types/zod';
import type { ListSchema } from '@object-ui/types';
// Registers the renderers at module scope, NOT inside a `beforeAll`: there the
// cold transform is billed to `hookTimeout` (object-ui/no-dynamic-import-in-test-hook,
// objectui#3010).
import '../renderers';

/** The literal the expressions guide teaches, typed against the declaration. */
const GUIDE_LIST: ListSchema = {
  type: 'list',
  title: 'Team',
  ordered: true,
  items: [{ content: 'Ada' }, { content: 'Linus' }],
};

// The declaration is a STRING: a number is refused on the TypeScript face, with
// or without `BaseSchema`'s index signature, because a declared member wins.
// @ts-expect-error -- `title` is declared `string`
const _NUMERIC_TITLE: ListSchema = { type: 'list', items: [], title: 42 };
void _NUMERIC_TITLE;

describe('list draws its declared `title` (objectui#11347)', () => {
  it("draws the expressions guide's title as the heading above the list", () => {
    const { container } = render(<SchemaRenderer schema={GUIDE_LIST} />);
    const heading = container.querySelector('h3');
    expect(heading?.textContent).toBe('Team');
    // The list itself still renders, under the heading.
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('LIVE CONTROL: a list without a title draws no heading', () => {
    const untitled: ListSchema = { ...GUIDE_LIST, title: undefined };
    const { container } = render(<SchemaRenderer schema={untitled} />);
    expect(container.querySelector('h3')).toBeNull();
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('the zod mirror declares it: a string parses, and a number is refused at `title`', () => {
    expect(ListMirror.safeParse(GUIDE_LIST).success).toBe(true);
    const refused = ListMirror.safeParse({ type: 'list', items: [], title: 42 });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.path.join('.'))).toContain('title');
  });
});
