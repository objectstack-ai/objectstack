// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5092 — two `SchemaForm` instances in ONE document must not share
 * their top-level ids.
 *
 * ## What was measured (baseline `fc1511152`, real `SchemaForm` renders)
 *
 * Two instances mounted at once, both with fields `name` / `label`:
 *
 * ```
 * ids: ["mdf-name","mdf-label","mdf-name","mdf-label"]
 * DUPLICATES: ["mdf-name","mdf-label"]
 * Name[0] host=page   -> target in=page value=page
 * Name[1] host=drawer -> target in=page value=page   <- the drawer's label,
 *                                                      wired to the PAGE control
 * ```
 *
 * objectui#5062 scoped NESTED rows by path and deliberately left top-level ids
 * spelled `mdf-{field}` — no instance dimension. That is fine for one form and
 * wrong the moment a second one is mounted: `MetadataDetailDrawer` is a Radix
 * `Sheet`, so opening it leaves the page's form IN THE DOM underneath, and a
 * `label[for]` resolves to the FIRST match in document order. Every field name
 * the two forms share (`name`, `label`, `description` — nearly always) made the
 * drawer's label focus, and assistive tech read, the control of the form the
 * drawer is covering. Resolved-to-the-wrong-element, not dangling — the same
 * failure class as #5062 / #3343, one scope up.
 *
 * ## What this file pins
 *
 *  1. the CROSS-WIRING, through the REAL mount points (`MetadataDetailDrawer`
 *     over `MetadataResourceEditPage`, for both drawer bodies) — not through a
 *     hand-passed `idPath`, which would stay green if a mount point dropped its
 *     scope segment;
 *  2. the PAGE contract: the page form's top-level ids are still exactly
 *     `mdf-{field}`. The scoping is additive, and #5062's "top level does not
 *     move" ruling survives this change untouched;
 *  3. the ASSERTION itself: a document that really does hold duplicate host ids
 *     makes the dev build shout. Scoping by mount point relies on every future
 *     host remembering to pass a segment; this is what stops a forgotten one
 *     from regressing in silence.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Bodies for the two metadata items the two forms edit. */
const BODIES: Record<string, Record<string, unknown>> = {
  page_item: { name: 'page_item', label: 'PAGE VALUE' },
  drawer_item: { name: 'drawer_item', label: 'DRAWER VALUE' },
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, name: string) => ({
    code: BODIES[name] ?? {},
    overlay: null,
    overlayScope: null,
    effective: BODIES[name] ?? {},
    packageId: 'sys_metadata',
    editable: true,
  })),
};

// `object` (the page + drawer editors) and `field` (the drawer's embedded-item
// editor) both expose top-level `name` / `label` — the field names that collide.
const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    label: { type: 'string', title: 'Label' },
  },
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        { type: 'object', name: 'object', label: 'Object', allowRuntimeCreate: true, schema: SCHEMA },
        { type: 'field', name: 'field', label: 'Field', allowRuntimeCreate: true, schema: SCHEMA },
      ],
    }),
  };
});

import { SchemaForm, DRAWER_METADATA_ID_SCOPE, DRAWER_EMBEDDED_ITEM_ID_SCOPE } from './SchemaForm';
import { MetadataResourceEditPage } from './ResourceEditPage';
import { MetadataDetailDrawer } from './MetadataDetailDrawer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Every `mdf-` id in the document, and the ones that appear more than once. */
function idCensus() {
  const ids = Array.from(document.querySelectorAll('[id^="mdf-"]')).map((e) => e.id);
  return { ids, duplicates: Array.from(new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) };
}

/** The element THIS label's `for` actually resolves to. */
function controlFor(label: HTMLElement): HTMLInputElement | null {
  const target = label.closest('label')!.getAttribute('for');
  return target ? (document.getElementById(target) as HTMLInputElement | null) : null;
}

/**
 * The page's form and the drawer's form, in one document — the production
 * arrangement: `ResourceEditPage` renders its own `SchemaForm` and then, as a
 * SIBLING, the drawer, which mounts a second editor on top without unmounting
 * the first.
 */
function renderPageWithDrawer(target: React.ComponentProps<typeof MetadataDetailDrawer>['target']) {
  return render(
    <MemoryRouter initialEntries={['/metadata/object/page_item']}>
      <div data-host="page">
        <MetadataResourceEditPage type="object" name="page_item" />
      </div>
      <div data-host="drawer-host">
        <MetadataDetailDrawer target={target} onClose={() => {}} parentContext={{ type: 'object', name: 'page_item' }} />
      </div>
    </MemoryRouter>,
  );
}

describe('#5092 — the drawer form and the page form do not share ids', () => {
  it('metadata drawer body: the drawer label resolves to the DRAWER control', async () => {
    renderPageWithDrawer({ kind: 'metadata', type: 'object', name: 'drawer_item' });

    // Both editors have loaded once both bodies are on screen.
    await waitFor(() => {
      expect(screen.getByDisplayValue('PAGE VALUE')).toBeInTheDocument();
      expect(screen.getByDisplayValue('DRAWER VALUE')).toBeInTheDocument();
    });

    // The measured defect: `["mdf-name","mdf-label"]`.
    expect(idCensus().duplicates).toEqual([]);

    // Assert on the VALUE behind each association, not on id inequality — two
    // distinct ids can still be wired to one element.
    const labels = screen.getAllByText('Label');
    expect(labels).toHaveLength(2);
    const [pageLabel, drawerLabel] = labels;
    expect(controlFor(pageLabel)).toHaveValue('PAGE VALUE');
    // Before: this read 'PAGE VALUE' — the control behind the drawer.
    expect(controlFor(drawerLabel)).toHaveValue('DRAWER VALUE');
    expect(controlFor(pageLabel)).not.toBe(controlFor(drawerLabel));

    // The drawer's own ids carry its scope segment; the page's do not.
    expect(document.getElementById(`mdf-${DRAWER_METADATA_ID_SCOPE}.label`)).toHaveValue('DRAWER VALUE');
    expect(document.getElementById('mdf-label')).toHaveValue('PAGE VALUE');
  });

  it('embedded-item drawer body: the drawer label resolves to the DRAWER control', async () => {
    renderPageWithDrawer({
      kind: 'embedded',
      parentType: 'object',
      parentName: 'page_item',
      groupLabel: 'Fields',
      itemName: 'email',
      editAs: 'field',
      embeddedPath: 'fields',
      raw: { name: 'email', label: 'DRAWER VALUE' },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('PAGE VALUE')).toBeInTheDocument();
      expect(screen.getByDisplayValue('DRAWER VALUE')).toBeInTheDocument();
    });

    expect(idCensus().duplicates).toEqual([]);

    const [pageLabel, drawerLabel] = screen.getAllByText('Label');
    expect(controlFor(pageLabel)).toHaveValue('PAGE VALUE');
    expect(controlFor(drawerLabel)).toHaveValue('DRAWER VALUE');
    expect(document.getElementById(`mdf-${DRAWER_EMBEDDED_ITEM_ID_SCOPE}.label`)).toHaveValue('DRAWER VALUE');
    expect(document.getElementById('mdf-label')).toHaveValue('PAGE VALUE');
  });
});

describe('#5092 — the page form keeps the historical top-level id spelling', () => {
  it('the page editor still spells its top-level ids `mdf-{field}`', async () => {
    render(
      <MemoryRouter initialEntries={['/metadata/object/page_item']}>
        <MetadataResourceEditPage type="object" name="page_item" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByDisplayValue('PAGE VALUE')).toBeInTheDocument());

    // The #5062 promise, re-pinned from the page side: the selector surface the
    // other metadata-admin suites read must not move because of this change.
    expect(document.getElementById('mdf-name')).toHaveValue('page_item');
    expect(document.getElementById('mdf-label')).toHaveValue('PAGE VALUE');
    expect(screen.getByText('Label').closest('label')).toHaveAttribute('for', 'mdf-label');
  });

  it('a bare SchemaForm with no idPath is byte-for-byte unchanged', () => {
    render(
      <SchemaForm schema={SCHEMA as never} value={{ name: 'n', label: 'l' }} onChange={() => {}} />,
    );
    expect(screen.getByText('Name').closest('label')).toHaveAttribute('for', 'mdf-name');
    expect(document.getElementById('mdf-name')).toHaveValue('n');
    expect(document.getElementById('mdf-label')).toHaveValue('l');
  });
});

describe('#5092 — the scope segments themselves', () => {
  it('are distinct, whitespace-free, and unspellable as a field name', () => {
    // Two scoped forms must not collide with each other either.
    expect(DRAWER_METADATA_ID_SCOPE).not.toBe(DRAWER_EMBEDDED_ITEM_ID_SCOPE);
    for (const seg of [DRAWER_METADATA_ID_SCOPE, DRAWER_EMBEDDED_ITEM_ID_SCOPE]) {
      // These ids are read as `aria-labelledby` IDREFs, which tokenize on
      // whitespace (#5062).
      expect(seg).not.toMatch(/\s/);
      // A `-` cannot occur in a metadata machine name (`^[a-z][a-z0-9_]*$`) nor
      // in the camelCase property names the metadata JSON-Schemas use, so
      // `mdf-{seg}.{field}` is not reachable from any real field path.
      expect(seg).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/);
    }
  });
});

describe('#5092 — the dev-only duplicate-host-id assertion', () => {
  it('shouts, naming the colliding ids, when two unscoped forms are mounted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The pre-fix arrangement, reconstructed on purpose: a second form with no
    // scope segment. This is what a NEW mount point that forgets one looks like.
    render(
      <div>
        <SchemaForm schema={SCHEMA as never} value={{ name: 'a', label: 'a' }} onChange={() => {}} />
        <SchemaForm schema={SCHEMA as never} value={{ name: 'b', label: 'b' }} onChange={() => {}} />
      </div>,
    );

    expect(idCensus().duplicates).toEqual(['mdf-name', 'mdf-label']);
    const shouted = spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[SchemaForm]'));
    expect(shouted.length).toBeGreaterThan(0);
    expect(shouted[0]).toContain('mdf-name');
    expect(shouted[0]).toContain('mdf-label');
    expect(shouted[0]).toContain('objectui#5092');
    spy.mockRestore();
  });

  it('stays quiet when the second form carries a scope segment', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <SchemaForm schema={SCHEMA as never} value={{ name: 'a', label: 'a' }} onChange={() => {}} />
        <SchemaForm
          schema={SCHEMA as never}
          idPath={DRAWER_METADATA_ID_SCOPE}
          value={{ name: 'b', label: 'b' }}
          onChange={() => {}}
        />
      </div>,
    );

    expect(idCensus().duplicates).toEqual([]);
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('[SchemaForm]'))).toEqual([]);
    spy.mockRestore();
  });

  it('does no work in a production build', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      render(
        <div>
          <SchemaForm schema={SCHEMA as never} value={{ name: 'a', label: 'a' }} onChange={() => {}} />
          <SchemaForm schema={SCHEMA as never} value={{ name: 'b', label: 'b' }} onChange={() => {}} />
        </div>,
      );
      // The collision is real; the diagnostic is a dev-build affordance only.
      expect(idCensus().duplicates).toEqual(['mdf-name', 'mdf-label']);
      expect(spy.mock.calls.filter((c) => String(c[0]).includes('[SchemaForm]'))).toEqual([]);
    } finally {
      process.env.NODE_ENV = prev;
      spy.mockRestore();
    }
  });
});
