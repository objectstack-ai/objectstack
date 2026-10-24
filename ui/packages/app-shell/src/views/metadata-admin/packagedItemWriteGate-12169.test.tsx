// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12169 — on a type the `OS_METADATA_WRITABLE` hatch elevates, an item
 * a package ships is read-only, and an item no package ships stays editable.
 *
 * ## Which item is editable is the SERVER's per-item answer
 *
 * ADR-0131 D6 seals managed content: the hatch opens a TYPE's writes of the
 * items no package ships, and never an item a package ships. That is a fact
 * about one item, so `GET /meta/types` (one entry per type) cannot carry it.
 * The item read does: `GET /meta/:type/:name/layers` serves the ADR-0010
 * protection envelope, and its `editable` is the write door's own verdict for
 * that item. objectstack's `servedLockState` asks `packagedBaseRefusal`, whose
 * seal predicate (`isSealedManagedItem`) reads the registry's overlay opt-in
 * alone and never the hatch. objectstack's own pin, in
 * `protocol.read-lock-flags-write-door.test.ts`, is "the operator hatch does
 * not open the packaged base, and the read says so": with the hatch open the
 * packaged item reads `{ lock: 'full', editable: false, deletable: false }`.
 * `MetadataClient.layered()` carries `editable` through unchanged.
 *
 * So every gate here reads that served answer. ⛔ None of them reads
 * `overrideSource` to tell the hatch from the registry opt-in: that would be a
 * client copy of the seal rule. The last block pins it, by crossing the two:
 * the same `overrideSource` with the opposite served answer flips each gate.
 *
 * ## One fixture per case, read by every gate
 *
 * Each case is an entry (as `/meta/types` serves it) plus an item envelope (as
 * the layered read serves it). Every gate is asserted on the same case:
 *
 *  - the editor (`MetadataResourceEditPage`), with a stub preview registered
 *    so the designer canvas's `editing` prop is visible: a designer-capable
 *    type opens straight into design mode when its item is writable;
 *  - the permission matrix's artifact tier (`PermissionMatrixEditPage`);
 *  - the header's writability badge (`PageShell`), drawn by both pages.
 *
 * The cases: the hatch-elevated packaged item (read-only), the same type's
 * runtime-only item (editable), and the CONTROL, a registry-opt-in type's
 * packaged item (as before this card: editable).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RichMetadataTypeEntry } from './useMetadata';

const PKG = 'com.example.showcase';
const ITEM = 'showcase_item';
const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, label: { type: 'string' } },
};

type Served = { lock: 'none' | 'full'; editable: boolean | undefined; deletable: boolean };

/** One case: how `/meta/types` serves the type, and how the layered read serves the item. */
interface Case {
  overrideSource: 'env' | 'registry';
  item: 'packaged' | 'runtime';
  served: Served;
}

/** The hatch elevates the type; a package ships the item: the server seals it. */
const HATCH_PACKAGED: Case = {
  overrideSource: 'env',
  item: 'packaged',
  served: { lock: 'full', editable: false, deletable: false },
};
/** The same type; no package ships the item: the hatch opens it. */
const HATCH_RUNTIME: Case = {
  overrideSource: 'env',
  item: 'runtime',
  served: { lock: 'none', editable: true, deletable: true },
};
/** CONTROL: a registry-opt-in type; a package ships the item, and the overlay channel is open. */
const REGISTRY_PACKAGED: Case = {
  overrideSource: 'registry',
  item: 'packaged',
  served: { lock: 'none', editable: true, deletable: true },
};

/** The layered envelope for `body` under one case. */
function layeredFor(c: Case, body: Record<string, unknown>) {
  if (c.item === 'packaged') {
    return {
      code: { ...body, _packageId: PKG },
      overlay: null,
      overlayScope: null,
      effective: body,
      provenance: 'package',
      packageId: PKG,
      ...c.served,
    };
  }
  return {
    code: null,
    overlay: body,
    overlayScope: 'env',
    effective: body,
    provenance: 'org',
    ...c.served,
  };
}

// ── Doubles ─────────────────────────────────────────────────────────────────

let entries: RichMetadataTypeEntry[] = [];
let layered: Record<string, unknown> = {};

const PERMISSION_SET = {
  name: ITEM,
  label: 'Contributor',
  objects: { a_account: { allowRead: true, allowCreate: true } },
  fields: {},
};

const mockClient = {
  list: vi.fn(async (type: string) =>
    type === 'object' ? [{ item: { name: 'a_account', label: 'Account' } }] : [],
  ),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async (type: string) =>
    type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null,
  ),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => layered),
  save: vi.fn(async (_t: string, _n: string, payload: Record<string, unknown>) => payload),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { PermissionMatrixEditPage } from './PermissionMatrixEditor';
import { registerMetadataPreview, type MetadataPreviewProps } from './preview-registry';

/** Draws the canvas's `editing` prop, which is what design mode is. */
function StubPreview({ editing }: MetadataPreviewProps) {
  return <div data-testid="stub-preview" data-editing={String(!!editing)} />;
}
registerMetadataPreview('agent', StubPreview);
registerMetadataPreview('view', StubPreview);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** `agent` for the hatch cases (no runtime create, as the registry declares); `view` for the CONTROL. */
function editorEntry(c: Case): RichMetadataTypeEntry {
  return c.overrideSource === 'env'
    ? {
        type: 'agent',
        label: 'Agent',
        allowEnvironmentOverlay: true,
        allowRuntimeCreate: false,
        overrideSource: 'env',
        supportsOverlay: false,
        schema: SCHEMA,
      }
    : {
        type: 'view',
        label: 'View',
        allowEnvironmentOverlay: true,
        allowRuntimeCreate: true,
        overrideSource: 'registry',
        supportsOverlay: true,
        schema: SCHEMA,
      };
}

async function renderEditor(c: Case) {
  const entry = editorEntry(c);
  entries = [entry];
  layered = layeredFor(c, { name: ITEM, label: 'Showcase item' });
  render(
    <MemoryRouter initialEntries={[`/metadata/${entry.type}/${ITEM}`]}>
      <MetadataResourceEditPage type={entry.type} name={ITEM} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
  await screen.findByTestId('stub-preview');
  // Let the designer auto-on effect settle before reading `editing`.
  await new Promise((r) => setTimeout(r, 30));
}

/** `permission` is the matrix's type; its registry declares runtime create. */
function matrixEntry(c: Case): RichMetadataTypeEntry {
  return {
    type: 'permission',
    label: 'Permission Set',
    allowEnvironmentOverlay: true,
    allowRuntimeCreate: true,
    overrideSource: c.overrideSource,
  };
}

async function renderMatrix(c: Case) {
  entries = [matrixEntry(c)];
  layered = layeredFor(c, PERMISSION_SET);
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name={ITEM} />
    </MemoryRouter>,
  );
  await screen.findByText('Account');
}

function designerEditing(): string | null {
  return screen.getByTestId('stub-preview').getAttribute('data-editing');
}

function writabilityBadge(): HTMLElement {
  return screen.getByText('writable', { exact: true });
}

const ARTIFACT_CAPTION = /provided by a code package/;

// ── The three cases, every gate ─────────────────────────────────────────────

describe('a hatch-elevated type: its PACKAGED item is read-only on every gate (objectui#12169)', () => {
  it('the editor opens it read-only: no design mode, no Edit, no Save, the lock banner', async () => {
    await renderEditor(HATCH_PACKAGED);

    expect(designerEditing()).toBe('false');
    expect(screen.queryByRole('tab', { name: /Design/ })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Edit$/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByTestId('lock-banner-title')).toBeInTheDocument();
  });

  it('the matrix artifact tier agrees: no Save, every grant locked, the artifact caption and its clone', async () => {
    await renderMatrix(HATCH_PACKAGED);

    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByText(ARTIFACT_CAPTION)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Clone to customize/ }).length).toBeGreaterThan(0);
  });

  it('the badge claims no more: its tooltip says the hatch never opens an item a package ships', async () => {
    await renderEditor(HATCH_PACKAGED);
    expect(writabilityBadge()).toHaveAttribute('title', expect.stringContaining('never an item a package ships'));
    cleanup();

    await renderMatrix(HATCH_PACKAGED);
    expect(writabilityBadge()).toHaveAttribute('title', expect.stringContaining('never an item a package ships'));
  });
});

describe('the same hatch-elevated type: an item NO package ships stays editable (objectui#12169)', () => {
  it('the editor opens it in design mode with its write controls', async () => {
    await renderEditor(HATCH_RUNTIME);

    expect(designerEditing()).toBe('true');
    expect(screen.getByRole('tab', { name: /Design/ })).toBeInTheDocument();
    expect(screen.queryByTestId('lock-banner-title')).toBeNull();
  });

  it('the matrix agrees: Save is offered and the grants are live', async () => {
    await renderMatrix(HATCH_RUNTIME);

    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(screen.queryByText(ARTIFACT_CAPTION)).toBeNull();
  });

  it('the badge says the hatch opens the items no package ships', async () => {
    await renderEditor(HATCH_RUNTIME);
    expect(writabilityBadge()).toHaveAttribute('title', expect.stringContaining('opens the items no package ships'));
  });
});

describe('CONTROL: a registry-opt-in type keeps its packaged item editable, as before (objectui#12169)', () => {
  it('the editor opens it in design mode', async () => {
    await renderEditor(REGISTRY_PACKAGED);

    expect(designerEditing()).toBe('true');
    expect(screen.getByRole('tab', { name: /Design/ })).toBeInTheDocument();
    expect(screen.queryByTestId('lock-banner-title')).toBeNull();
  });

  it('the matrix agrees: Save is offered and the grants are live', async () => {
    await renderMatrix(REGISTRY_PACKAGED);

    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(screen.queryByText(ARTIFACT_CAPTION)).toBeNull();
  });

  it('the badge names the registry opt-in', async () => {
    await renderEditor(REGISTRY_PACKAGED);
    expect(writabilityBadge()).toHaveAttribute('title', 'Writable per ADR-0005 overlay opt-in');
  });
});

// ── The gates follow the served answer, never `overrideSource` ──────────────

describe('the gates read the served `editable`, never `overrideSource` (objectui#12169)', () => {
  /** A server from before ADR-0131 D6, whose hatch did open a packaged item. */
  const HATCH_PACKAGED_OPENED: Case = { ...HATCH_PACKAGED, served: { lock: 'none', editable: true, deletable: true } };
  /** A registry-opt-in item the server refuses anyway (for one, its own ADR-0010 `_lock`). */
  const REGISTRY_PACKAGED_REFUSED: Case = { ...REGISTRY_PACKAGED, served: { lock: 'full', editable: false, deletable: false } };

  it('`env` with a served `editable: true`: the editor and the matrix are writable', async () => {
    await renderEditor(HATCH_PACKAGED_OPENED);
    expect(designerEditing()).toBe('true');
    cleanup();

    await renderMatrix(HATCH_PACKAGED_OPENED);
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
  });

  it('`registry` with a served `editable: false`: the editor and the matrix are read-only', async () => {
    await renderEditor(REGISTRY_PACKAGED_REFUSED);
    expect(designerEditing()).toBe('false');
    cleanup();

    await renderMatrix(REGISTRY_PACKAGED_REFUSED);
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });
});
