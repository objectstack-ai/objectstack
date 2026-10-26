/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:header-bar` delivers the `BaseSchema` DOM channels to its root `header`
 * (objectui#10496).
 *
 * `SchemaRenderer` hands every registered component `aria-label` (resolved from
 * `ariaLabel`), `data-obj-id` / `data-obj-type`, a conditional `data-testid`
 * (from `testId`), `style` and `id` as props. The renderer was registered as a
 * function of `schema` alone, so all of them were dropped: an accessible name
 * the author declared never reached the landmark, and `style` / `id` rendered
 * byte-identical to their absence. objectui#10397 had already made the root
 * honour `className`; nothing else arrived.
 *
 * The root now takes the converged route every other converged renderer in
 * this package takes: `toDomProps` (the SDUI whitelist in `@object-ui/core`)
 * over the props it is handed, plus `style` forwarded by name. So the rows
 * below come in two halves, and both are needed:
 *
 *   - the DECLARED channels reach the root, one key per row;
 *   - an UNDECLARED key, and the keys the renderer consumes off `schema`, still
 *     do not reach the DOM. This is what tells the whitelist apart from a bare
 *     `{...props}` spread, which would turn every row in the first half green
 *     as well.
 *
 * Every row renders through the real `SchemaRenderer` and the real registry,
 * the path an authored JSON node takes, inside the `SidebarProvider` host
 * `SidebarTrigger` needs (see `header-bar-classname-10397.test.tsx`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Registered at module scope, NOT in a `beforeAll`: there the cold transform is
// billed to `hookTimeout`, which is narrower than the timeout it replaces
// (objectui#3010 / #3021, and `object-ui/no-dynamic-import-in-test-hook`).
import '../renderers';
import { SidebarProvider } from '../ui';

afterEach(() => cleanup());

const LABEL = 'Workspace header 10496';
const ID = 'hb-10496';
const TEST_ID = 'hb-testid-10496';
/** Not a colour: AGENTS.md keeps colour off inline styles, and any property proves the channel. */
const STYLE = { minWidth: '12rem' };
/** A key no surface declares, with a value no other part of the tree prints. */
const UNDECLARED_KEY = 'zzUndeclared10496';
const UNDECLARED_VALUE = 'zz-leak-10496';

function mount(schema: Record<string, unknown>): { header: HTMLElement; container: HTMLElement } {
  const { container } = render(
    <SidebarProvider>
      <SchemaRenderer schema={{ type: 'header-bar', ...schema } as never} />
    </SidebarProvider>,
  );
  const header = container.querySelector('header');
  if (!header) throw new Error('no header element: the harness did not mount the real renderer');
  return { header, container };
}

describe('ui:header-bar delivers the BaseSchema DOM channels to its root (objectui#10496)', () => {
  it('harness: the real header mounts, with its sidebar trigger inside it', () => {
    const { header } = mount({});
    expect(header.querySelector('[data-sidebar="trigger"]')).not.toBeNull();
  });

  it('`ariaLabel` becomes the banner landmark\'s accessible name', () => {
    const { header } = mount({ ariaLabel: LABEL });
    expect(screen.getByRole('banner', { name: LABEL })).toBe(header);
    expect(header.getAttribute('aria-label')).toBe(LABEL);
  });

  it('`style` reaches the root', () => {
    const { header } = mount({ style: STYLE });
    expect(header.style.minWidth).toBe(STYLE.minWidth);
  });

  it('`id` reaches the root', () => {
    const { header } = mount({ id: ID });
    expect(header.id).toBe(ID);
  });

  it('`testId` reaches the root as `data-testid`', () => {
    const { header } = mount({ testId: TEST_ID });
    expect(header.getAttribute('data-testid')).toBe(TEST_ID);
  });

  it('`data-obj-id` / `data-obj-type` reach the root', () => {
    const { header } = mount({ id: ID });
    expect(header.getAttribute('data-obj-id')).toBe(ID);
    expect(header.getAttribute('data-obj-type')).toBe('header-bar');
  });

  it('each declared channel lands ONCE, on the root and on no other element', () => {
    const { header, container } = mount({ id: ID, ariaLabel: LABEL, testId: TEST_ID });
    for (const selector of [`[aria-label="${LABEL}"]`, `[id="${ID}"]`, `[data-testid="${TEST_ID}"]`]) {
      const hits = container.querySelectorAll(selector);
      expect(hits, selector).toHaveLength(1);
      expect(hits[0], selector).toBe(header);
    }
  });

  it('control: an undeclared key and the consumed keys do not reach the DOM', () => {
    // Absence only, so the row does not depend on the wiring the rows above
    // pin: with the renderer reading `schema` alone it is green too. What it
    // tells apart is the whitelist from a bare `{...props}` spread, under which
    // every one of these keys lands on the root and this row goes red.
    const { header, container } = mount({
      ariaLabel: LABEL,
      [UNDECLARED_KEY]: UNDECLARED_VALUE,
      crumbs: [{ label: 'Home', href: '#' }, { label: 'Here' }],
      search: { enabled: true, placeholder: 'Find' },
    });
    const names = header.getAttributeNames();
    expect(names).not.toContain(UNDECLARED_KEY.toLowerCase());
    // Consumed off `schema`, never forwarded; and the camelCase `ariaLabel` the
    // author wrote is not an attribute, only the resolved `aria-label` is.
    for (const consumed of ['crumbs', 'search', 'type', 'arialabel', 'testid']) {
      expect(names, consumed).not.toContain(consumed);
    }
    expect(container.innerHTML).not.toContain(UNDECLARED_VALUE);
  });

  it('with every channel authored, the root carries exactly these attributes', () => {
    const { header } = mount({
      id: ID,
      ariaLabel: LABEL,
      testId: TEST_ID,
      style: STYLE,
      className: 'zz-header-bar-10496',
      [UNDECLARED_KEY]: UNDECLARED_VALUE,
    });
    // Sorted: which order React sets attributes in is not the contract.
    expect([...header.getAttributeNames()].sort()).toEqual(
      ['aria-label', 'class', 'data-obj-id', 'data-obj-type', 'data-testid', 'id', 'style'],
    );
  });
});
