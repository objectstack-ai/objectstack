// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4271 — the field half of the permission matrix, driven through a
 * REAL `MetadataClient` answering the REAL server shape.
 *
 * Every other test in this family hands the editor a hand-rolled client whose
 * `get()` returns a bare `{ fields }` body — i.e. the shape the client's
 * DOCBLOCK promises. Production answers `GET /meta/:type/:name` with the
 * spec-declared envelope `{ type, name, item }` (objectstack#5563), so the
 * doubles agreed with the documentation while the real client disagreed with
 * both, and the whole suite stayed green while the field sub-table was dead for
 * every object on every screen.
 *
 * These cases close that gap: `useMetadataClient` is mocked to hand back a
 * genuine `MetadataClient` wired to a fetch that answers exactly what the
 * framework answers. Nothing here mocks `get()` itself.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

/** The card's live object: `showcase_project`, 21 fields, served under `item`. */
const FIELD_NAMES = [
  'amount', 'budget', 'category', 'closed_at', 'code', 'created_at', 'description',
  'due_date', 'email', 'is_active', 'name', 'notes', 'owner_id', 'phone', 'priority',
  'region', 'revenue', 'stage', 'status', 'tags', 'updated_at',
];

const OBJECT_ITEM = {
  name: 'showcase_project',
  label: 'Project',
  fields: Object.fromEntries(FIELD_NAMES.map((n) => [n, { type: 'text', label: n }])),
};

/** Exactly what `GET /api/v1/meta/object/showcase_project` returns (200). */
const OBJECT_ENVELOPE = { type: 'object', name: 'showcase_project', item: OBJECT_ITEM };

let capturedFacetProps: Record<string, any> | null = null;

vi.mock('./PermissionAdvancedFacets', () => ({
  PermissionAdvancedFacets: (props: Record<string, any>) => {
    capturedFacetProps = props;
    return null;
  },
}));

let clientImpl: MetadataClient;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(() => {
  cleanup();
  capturedFacetProps = null;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A real MetadataClient over a fetch that speaks the framework's shapes. */
function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      // The layered read's declared path (objectstack#5882 ruling B, migrated
      // in objectui#4016). Kept exact so this double stays truthful about what
      // the real client puts on the wire — the next reader copies from here.
      //
      // Measured, not assumed: it carries no assertion pressure. Reverting the
      // client to the retired query flag leaves all three cases below GREEN,
      // because the layered body only feeds the artifact-backed verdict and the
      // permission draft, and the field sub-table these cases assert is fed by
      // the `get()` read further down. The URL itself is pinned where it belongs,
      // in `packages/data-objectstack/src/metadata-client.layeredRoute.test.ts`.
      if (url.endsWith('/meta/permission/sales_perms/layers')) {
        return json({
          code: null,
          overlay: null,
          overlayScope: null,
          effective: {
            name: 'sales_perms',
            label: 'Sales',
            objects: { showcase_project: { allowRead: true } },
            fields: {},
          },
        });
      }
      // The single-item read — the ONE shape #5563 left standing.
      if (/\/meta\/object\/showcase_project(\?|$)/.test(url)) return json(OBJECT_ENVELOPE);
      if (/\/meta\/object(\?|$)/.test(url)) {
        return json({ items: [{ name: 'showcase_project', label: 'Project' }] });
      }
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

async function renderExpanded() {
  clientImpl = realClient();
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /showcase_project/ }));
}

describe('objectui#4271 · the field sub-table survives the real server envelope', () => {
  it('B1: lists the object’s fields with a readable/editable pair each', async () => {
    await renderExpanded();

    // The card's headline symptom, gone.
    expect(await screen.findByLabelText('showcase_project.email readable')).toBeInTheDocument();
    expect(screen.queryByText('No fields registered for this object.')).toBeNull();

    // All 21 fields, both checkboxes each — the 42 the matrix owed this object.
    for (const f of FIELD_NAMES) {
      expect(screen.getByLabelText(`showcase_project.${f} readable`)).toBeInTheDocument();
      expect(screen.getByLabelText(`showcase_project.${f} editable`)).toBeInTheDocument();
    }

    // 21 > 6, so the field filter is offered — the affordance the QA run
    // (objectstack#7695) could not exercise because no row ever rendered.
    expect(screen.getByLabelText('Filter fields…')).toBeInTheDocument();
  });

  it('B1b: the checkbox pair is live, not decorative', async () => {
    await renderExpanded();

    // Default field posture is readable-but-not-editable, so `editable` is the
    // half with somewhere to travel.
    const editable = await screen.findByLabelText('showcase_project.stage editable');
    expect(editable).not.toBeChecked();
    expect(screen.getByLabelText('showcase_project.stage readable')).toBeChecked();

    fireEvent.click(editable);
    expect(screen.getByLabelText('showcase_project.stage editable')).toBeChecked();
  });

  it('B2: loadObjectFields feeds the RLS CEL editor real field names', async () => {
    // The collateral the card names: CEL lint + autocomplete resolve their
    // field set through the same repaired read.
    await renderExpanded();
    expect(capturedFacetProps?.loadObjectFields).toBeTypeOf('function');

    const names = await capturedFacetProps!.loadObjectFields('showcase_project');
    expect(names).toEqual([...FIELD_NAMES].sort((a, b) => a.localeCompare(b)));
  });
});
