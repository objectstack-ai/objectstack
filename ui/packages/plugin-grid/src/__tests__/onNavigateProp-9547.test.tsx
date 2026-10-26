/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9547 — `onNavigate` is a prop on `ObjectGridComponentProps`, the
 * prop wins over `schema.onNavigate`, and the four faces of the list channel
 * take one closed mode token.
 *
 * ## What was wrong
 *
 * `ObjectGridSchema.onNavigate`'s docblock sent programmatic callers to
 * `ObjectGridComponentProps` — "that is where a caller should prefer to pass
 * this one too" — and the interface did not declare it. A host that followed
 * the advice passed a function the grid never called, with no diagnostic.
 *
 * ## What the maintainer ruled (ruling C on objectui#9547)
 *
 * The prop exists and is read as `props.onNavigate ?? schema.onNavigate`: the
 * programmatic caller is the nearer party, so the prop wins. Its second
 * argument is the closed union `'view' | 'new_window'` — the vocabulary
 * `useNavigationOverlay` emits and the `@objectstack/spec` react-tier
 * `ListView` catalogue publishes — and the three sibling faces
 * (`ObjectGridSchema.onNavigate`, `ListViewRuntimeProps.onNavigate`,
 * `UseNavigationOverlayOptions.onNavigate`) take the same type. ⛔ No `string`,
 * ⛔ no `'edit'`: no branch of the hook emits it.
 *
 * ## The pins
 *
 * - behavioural: the prop fires in `page` mode with `'view'`; a modifier click
 *   delivers `'new_window'` to it; with BOTH supplied only the prop fires. The
 *   schema-only case is the control and already lives in
 *   `gridNonAuthorKeys.test.tsx` ("the renderer still reads it").
 * - type-level: the four faces' second parameter IS `RecordNavigateAction`,
 *   required, and that type is exactly the two members. Compiled by this
 *   package's `tsconfig.test.json`; vitest erases them.
 * - spec: the catalogue row's `type` STRING names the same members, so the
 *   one hand-spelled union in `@object-ui/types` cannot drift from it quietly.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { REACT_BLOCKS } from '@objectstack/spec/ui';
import { ActionProvider, type UseNavigationOverlayOptions } from '@object-ui/react';
import type { ListViewSchema, ObjectGridSchema, RecordNavigateAction } from '@object-ui/types';
import { ObjectGrid } from '../ObjectGrid';
import type { ObjectGridComponentProps } from '../ObjectGrid';

const rows = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
];

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: rows, total: rows.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'test_object',
      fields: { id: { type: 'text' }, name: { type: 'text' }, email: { type: 'text' } },
    }),
  };
}

function renderGrid(
  schemaExtra: Record<string, unknown>,
  props: Partial<ObjectGridComponentProps> = {},
) {
  const schema = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }, { field: 'email', label: 'Email' }],
    data: { provider: 'value', items: rows },
    navigation: { mode: 'page' },
    ...schemaExtra,
  } as ObjectGridSchema;
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={makeAdapter() as any} {...props} />
    </ActionProvider>,
  );
}

/** Alice's email cell — a plain cell, so the click reaches the row handler. */
async function aliceCell(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText('alice@example.com')).toBeInTheDocument());
  const cell = Array.from(container.querySelectorAll('tbody td')).find(
    (td) => td.textContent?.trim() === 'alice@example.com',
  );
  expect(cell, 'the fixture row never rendered, so a silent no-call would look like a pass').toBeTruthy();
  return cell as HTMLElement;
}

describe('objectui#9547 — the `onNavigate` PROP reaches the row click', () => {
  it('fires in `page` mode with the record id and `view`', async () => {
    const onNavigate = vi.fn();
    const { container } = renderGrid({ id: 'prop-page' }, { onNavigate });

    fireEvent.click(await aliceCell(container));

    await waitFor(() =>
      expect(
        onNavigate,
        'the `onNavigate` PROP no longer fires on a row click — the read at the'
          + ' `useNavigationOverlay` call stopped consulting the prop.',
      ).toHaveBeenCalledTimes(1),
    );
    expect(onNavigate).toHaveBeenCalledWith('1', 'view');
  });

  it('a modifier click delivers the other member, `new_window`, to the same prop', async () => {
    const onNavigate = vi.fn();
    const { container } = renderGrid({ id: 'prop-meta' }, { onNavigate });

    fireEvent.click(await aliceCell(container), { metaKey: true });

    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1));
    expect(onNavigate).toHaveBeenCalledWith('1', 'new_window');
  });

  it('with BOTH supplied, the prop wins and the schema key is not called', async () => {
    const fromProp = vi.fn();
    const fromSchema = vi.fn();
    const { container } = renderGrid({ id: 'prop-wins', onNavigate: fromSchema }, { onNavigate: fromProp });

    fireEvent.click(await aliceCell(container));

    await waitFor(() => expect(fromProp).toHaveBeenCalledTimes(1));
    expect(fromProp).toHaveBeenCalledWith('1', 'view');
    expect(
      fromSchema,
      '`schema.onNavigate` fired although the prop was supplied — ruling C on objectui#9547'
        + ' made the prop win (`props.onNavigate ?? schema.onNavigate`).',
    ).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// One type, four faces — compile-time. The `it` below only keeps the suite
// honest about there being nothing to run; `tsc -p tsconfig.test.json` is what
// checks these.
// ---------------------------------------------------------------------------

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type ActionOf<F> = F extends (recordId: string | number, action: infer A) => void ? A : never;
type ArityOf<F> = F extends (...args: infer P) => void ? P['length'] : never;

type PropFace = NonNullable<ObjectGridComponentProps['onNavigate']>;
type SchemaFace = NonNullable<ObjectGridSchema['onNavigate']>;
type ListViewFace = NonNullable<ListViewSchema['onNavigate']>;
type HookFace = NonNullable<UseNavigationOverlayOptions['onNavigate']>;

/** The two members, spelled once more so the spec comparison has a runtime value. */
const MEMBERS = ['new_window', 'view'] as const satisfies readonly RecordNavigateAction[];

type _TypeIsTheTwoMembers = Assert<Equal<RecordNavigateAction, 'view' | 'new_window'>>;
type _MembersAreExhaustive = Assert<Equal<(typeof MEMBERS)[number], RecordNavigateAction>>;
type _NotAny = Assert<Equal<IsAny<RecordNavigateAction>, false>>;
type _PropFace = Assert<Equal<ActionOf<PropFace>, RecordNavigateAction>>;
type _SchemaFace = Assert<Equal<ActionOf<SchemaFace>, RecordNavigateAction>>;
type _ListViewFace = Assert<Equal<ActionOf<ListViewFace>, RecordNavigateAction>>;
type _HookFace = Assert<Equal<ActionOf<HookFace>, RecordNavigateAction>>;
// Required on every face, as the catalogue types it: an optional `action?`
// would read `1 | 2` here and hand a host `undefined` to branch on.
type _PropArity = Assert<Equal<ArityOf<PropFace>, 2>>;
type _SchemaArity = Assert<Equal<ArityOf<SchemaFace>, 2>>;
type _ListViewArity = Assert<Equal<ArityOf<ListViewFace>, 2>>;
type _HookArity = Assert<Equal<ArityOf<HookFace>, 2>>;

describe('objectui#9547 — the four faces take one closed mode token', () => {
  it('is pinned at compile time', () => {
    expect(MEMBERS).toHaveLength(2);
  });

  it('the `@objectstack/spec` react-tier `ListView` catalogue row names exactly these members', () => {
    const listView = REACT_BLOCKS.find((block) => block.tag === 'ListView');
    expect(listView, 'the spec catalogue no longer carries a `ListView` block').toBeTruthy();
    const row = listView!.interactions.find((prop) => prop.name === 'onNavigate');
    expect(row, 'the spec `ListView` block no longer carries an `onNavigate` row').toBeTruthy();

    // The catalogue types the callback as TEXT, e.g.
    // "(recordId, action: 'view' | 'new_window') => void" — read the union out.
    const union = /action\??:\s*([^)]*)\)/.exec(row!.type)?.[1];
    expect(union, `the catalogue row's type no longer names an \`action\` parameter: ${row!.type}`).toBeTruthy();
    const specMembers = union!
      .split('|')
      .map((member) => member.trim().replace(/^'|'$/g, ''))
      .sort();

    expect(
      specMembers,
      '`@objectstack/spec` now publishes a different navigation-mode vocabulary for'
        + ' `ListView.onNavigate` than `RecordNavigateAction` in `@object-ui/types`. Move the'
        + ' union there (and the four faces with it), or raise it upstream — never widen one side alone.',
    ).toEqual([...MEMBERS].sort());
  });
});
