/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9673 — the `context` PageView hands `SchemaRenderer` is BUILT, not read.
 *
 * `PageSchema` refuses a page-level `context` key, so a stored page that parses
 * never carries one. PageView used to spread `(page as any).context` into the
 * node anyway: a no-op on every parsed page, and a channel that read as
 * author-supplied page context that no author could supply. Ruled "remove"
 * (comment 5811058824): the node's `context` is exactly `{ params }` — the
 * `refreshKey` it also carried when this was ruled left with objectui#10519,
 * which measured that no block read it.
 *
 * The second case is the discriminating one: a document that never passed
 * `PageSchema` and sneaks `context` in through a cast must not leak it into the
 * node. With the spread restored, that case goes red.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { PageSchema } from '@objectstack/spec/ui';

// Lowercase snake_case: PageSchema refuses any other `name`, and the control
// below needs a page that parses.
const PAGE_NAME = 'the_page';

/** Query string the next `render()` sees; PageView turns it into `params`. */
let search = '';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ pageName: PAGE_NAME }),
  useSearchParams: () => [new URLSearchParams(search), vi.fn()],
  useNavigate: () => vi.fn(),
  // PageView reads the router's root href for its record navigator (objectui#12233).
  useHref: () => '/',
  useLocation: () => ({ pathname: `/apps/cloud/page/${PAGE_NAME}`, search: search ? `?${search}` : '' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'User', role: 'user', image: null },
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? o?.name ?? k }),
}));

/** The stored page document the next `render()` will resolve. */
let storedPage: Record<string, unknown> | undefined;

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ pages: storedPage ? [storedPage] : [], objects: [] }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

/** Every schema node handed to `SchemaRenderer` since the last render. */
const written: Record<string, any>[] = [];

vi.mock('@object-ui/react', async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    useAdapter: () => ({}),
    SchemaRenderer: ({ schema }: { schema: Record<string, any> }) => {
      written.push(schema);
      return null;
    },
  };
});

import { PageView } from '../PageView';

/** Mount `PageView` over one stored document and return the node it wrote. */
function writeFor(doc: Record<string, unknown>, query: string): Record<string, any> | undefined {
  cleanup();
  written.length = 0;
  search = query;
  storedPage = doc;
  render(<PageView />);
  return written[0];
}

const PARSED_PAGE = { name: PAGE_NAME, label: 'A Page', type: 'app' };

describe('objectui#9673 — PageView builds the node context, it never reads one off the page', () => {
  it('hands SchemaRenderer a context of exactly { params } for a page that parses', () => {
    // Control: the fixture is a page PageSchema accepts, so this is the case
    // every real author is in.
    expect(PageSchema.safeParse(PARSED_PAGE).success).toBe(true);

    const schema = writeFor(PARSED_PAGE, 'account=42&tab=notes');

    // Firing control: absence means the harness stopped reaching SchemaRenderer.
    expect(schema, 'PageView rendered no schema at all; this probe measured nothing').toBeDefined();
    expect(schema!.context).toEqual({ params: { account: '42', tab: 'notes' } });
  });

  it('a document that sneaks `context` in past PageSchema does not leak it into the node', () => {
    const smuggled = { ...PARSED_PAGE, context: { leaked: 'author-value', params: { account: 'forged' } } };

    // Why no author can reach this: PageSchema refuses the key outright.
    expect(PageSchema.safeParse(smuggled).success).toBe(false);

    const schema = writeFor(smuggled as Record<string, unknown>, 'account=42');

    expect(schema, 'PageView rendered no schema at all; this probe measured nothing').toBeDefined();
    expect(
      schema!.context,
      'the node context must be built from the route alone; a `context` key on the stored page ' +
        'is one PageSchema refuses and must not reach SchemaRenderer (objectui#9673).',
    ).toEqual({ params: { account: '42' } });
  });
});
