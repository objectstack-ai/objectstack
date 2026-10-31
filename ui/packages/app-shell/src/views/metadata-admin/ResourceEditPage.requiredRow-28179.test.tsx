// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28179 — a served form row marked `required: true` is not only a
 * star. The permission set's Identity row `label` is required in the served
 * form while `PermissionSetSchema.label` stays optional, so neither the live
 * Zod pass nor the server refuses an empty one: the page does.
 *
 *   (a) New Permission Set, Label empty, Name typed, Save: no `PUT`, and the
 *       refusal is the inline error on Label; typing a Label then saves;
 *   (b) CONTROL — the same page over a served form whose Label row is not
 *       required: an empty Label saves, the field stays optional;
 *   (c) a field the served SCHEMA requires keeps its own verdict: Save still
 *       sends (the server's refusal path, as before) and the new message is not
 *       added beside the schema's.
 *
 * The REAL page over a REAL `MetadataClient` whose transport is an in-memory
 * server recording every `PUT`, with the real served form from
 * `METADATA_FORM_REGISTRY`. Which rows count as offered is pinned in
 * `SchemaForm.requiredRows-28179.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { z } from 'zod';
import { getMetadataCreateSeed, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { MetadataClient } from '@object-ui/data-objectstack';
import { t } from './i18n';

const REQUIRED = t('engine.validation.fieldRequired', 'en-US');

const server = {
  puts: [] as Array<{ name: string; body: Record<string, unknown> }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (seg.length === 1) return json(200, { items: [] });
  if (method === 'PUT') {
    server.puts.push({ name: seg[1]!, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return json(200, { success: true, version: 'hmac-sha256:v1', seq: 1, state: 'draft', message: `Saved ${seg[0]}/${seg[1]}` });
  }
  return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
}

const PERMISSION_JSON_SCHEMA = z.toJSONSchema(getMetadataTypeSchema('permission') as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

const SERVED_FORM = METADATA_FORM_REGISTRY.permission as unknown as {
  sections: Array<{ fields: Array<string | { field: string; required?: boolean }> }>;
};

/** The served form with the Label row's `required` taken off — (b) only. */
function formWithOptionalLabel() {
  return {
    ...SERVED_FORM,
    sections: SERVED_FORM.sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => {
        if (typeof f === 'string' || f.field !== 'label') return f;
        const { required: _required, ...rest } = f;
        return rest;
      }),
    })),
  };
}

const served = vi.hoisted(() => ({
  form: undefined as unknown,
  schema: undefined as unknown,
}));

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        {
          type: 'permission',
          label: 'Permission Set',
          domain: 'security',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: served.schema,
          form: served.form,
          createSeed: getMetadataCreateSeed('permission') as Record<string, unknown>,
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { registerBuiltinAnchors } from './anchors';

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
// The live registration: Label → Name derive, `createFields: ['label', 'name']`.
registerBuiltinAnchors();

beforeEach(() => {
  server.puts = [];
  served.form = SERVED_FORM;
  served.schema = PERMISSION_JSON_SCHEMA;
});
afterEach(() => {
  cleanup();
});

const saveButton = () => screen.getByTestId('resource-save');

async function openNewPermissionSet() {
  render(
    <MemoryRouter initialEntries={['/metadata/permission/new']}>
      <Routes>
        <Route path="/metadata/permission/new" element={<MetadataResourceEditPage type="permission" name="" createMode />} />
        <Route path="/metadata/permission/:name" element={<div data-testid="landed" />} />
      </Routes>
    </MemoryRouter>,
  );
  const nameBox = await screen.findByRole('textbox', { name: /^Name/ }, { timeout: 8000 });
  const labelBox = screen.getByRole('textbox', { name: /^Label/ });
  return { nameBox, labelBox };
}

/** The row hosting `control` — the field's own block in the form grid. */
function rowOf(control: HTMLElement): HTMLElement {
  return control.closest('[style*="grid-column"]') as HTMLElement;
}

describe('a served required row holds Save (objectstack#28179)', () => {
  it('(a) empty Label + typed Name is refused at Label with no PUT; a typed Label then saves', async () => {
    const { nameBox, labelBox } = await openNewPermissionSet();
    expect(PERMISSION_JSON_SCHEMA.required ?? []).not.toContain('label');
    fireEvent.change(nameBox, { target: { value: 'sales_ops' } });
    fireEvent.click(saveButton());
    const issue = await within(rowOf(labelBox)).findByTestId('schema-form-issue', {}, { timeout: 8000 });
    expect(issue).toHaveTextContent(REQUIRED);
    expect(within(rowOf(nameBox)).queryByTestId('schema-form-issue')).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(server.puts).toEqual([]);
    expect(screen.queryByTestId('landed')).toBeNull();

    fireEvent.change(labelBox, { target: { value: 'Sales Ops' } });
    await waitFor(() => expect(within(rowOf(labelBox)).queryByTestId('schema-form-issue')).toBeNull());
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    expect(server.puts[0]!.name).toBe('sales_ops');
    expect(server.puts[0]!.body.label).toBe('Sales Ops');
    await screen.findByTestId('landed', {}, { timeout: 8000 });
  });

  it('(b) CONTROL — a served Label row that is not required stays optional: an empty Label saves', async () => {
    served.form = formWithOptionalLabel();
    const { nameBox } = await openNewPermissionSet();
    fireEvent.change(nameBox, { target: { value: 'sales_ops' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    expect(server.puts[0]!.body.label).toBeUndefined();
    expect(screen.queryByText(REQUIRED)).toBeNull();
    await screen.findByTestId('landed', {}, { timeout: 8000 });
  });

  it('(c) a field the served schema requires keeps its own verdict: Save still sends, no second message', async () => {
    served.schema = { ...PERMISSION_JSON_SCHEMA, required: [...((PERMISSION_JSON_SCHEMA.required as string[]) ?? []), 'label'] };
    const { nameBox } = await openNewPermissionSet();
    fireEvent.change(nameBox, { target: { value: 'sales_ops' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    expect(screen.queryByText(REQUIRED)).toBeNull();
  });
});
