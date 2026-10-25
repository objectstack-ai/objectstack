/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11253 — a stored `radio` with no options, which this page carries
 * through unedited, holds every save from it, and the page names the field.
 *
 * `radio` is outside the Field Designer's vocabulary, so `MetadataFieldsPage`
 * re-emits a stored one verbatim on every save (objectui#8060). Since the object
 * write guard holds a choice field with no option source (the objectui half of
 * the ruling on objectstack#20827), such a field now holds EVERY save from this
 * page, including an edit to an unrelated field. The remedy is not on this page:
 * the carried-through section already points the author to metadata-admin.
 *
 * Driven like the census suite beside it: the REAL page, a REAL
 * `MetadataClient` over a fetch double, and the captured PUTs. `FieldDesigner`
 * is the only double, a prop recorder, so the read / partition / merge / save
 * chain and the door guard all run for real. The control is the same page with
 * the radio carrying one option, observed to save.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';

interface RecordedDesignerProps {
  fields: DesignerFieldDefinition[];
  onFieldsChange?: (fields: DesignerFieldDefinition[]) => void;
}

let designerProps: RecordedDesignerProps | null = null;

vi.mock('./FieldDesigner', () => ({
  FieldDesigner: (props: RecordedDesignerProps) => {
    designerProps = props;
    return null;
  },
}));

import { MetadataFieldsPage } from './MetadataFieldsPage';

let puts: Array<{ url: string; body: { fields: Record<string, Record<string, unknown>> } }> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function realClient(fields: Record<string, Record<string, unknown>>): MetadataClient {
  const body = { name: 'showcase_project', label: 'Project', fields: { name: { type: 'text', label: 'Name' }, ...fields } };
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        puts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        return json({ success: true, name: 'showcase_project' });
      }
      if (/\/meta\/object\/showcase_project(\?|$)/.test(url)) {
        return json({ type: 'object', name: 'showcase_project', item: body });
      }
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

/** Mount the page over a stored object, then relabel ONLY the unrelated `name` field. */
async function relabelUnrelatedField(stored: Record<string, Record<string, unknown>>): Promise<void> {
  render(<MetadataFieldsPage objectName="showcase_project" client={realClient(stored)} />);
  await waitFor(() => expect(designerProps).not.toBeNull());
  const next = designerProps!.fields.map((f) => (f.name === 'name' ? { ...f, label: 'Renamed by the author' } : f));
  await act(async () => {
    designerProps!.onFieldsChange!(next);
  });
}

beforeEach(() => {
  puts = [];
  designerProps = null;
});

afterEach(() => {
  cleanup();
  designerProps = null;
});

describe('MetadataFieldsPage — a stored option-less radio holds the save (objectui#11253)', () => {
  it('holds an unrelated edit, names the field, and the page points to metadata-admin', async () => {
    await relabelUnrelatedField({ vote: { type: 'radio', label: 'Vote' } });

    const banner = await screen.findByTestId('metadata-fields-page-error');
    expect(banner).toHaveTextContent(/`vote` is a `radio` with no options/);
    expect(puts).toEqual([]);
    // The field is carried through unedited here, and the only remedy is where
    // the page's own carried-through section already sends the author.
    expect(screen.getByTestId('metadata-fields-page-preserved-vote')).toBeTruthy();
    expect(screen.getByTestId('metadata-fields-page-preserved')).toHaveTextContent(/Use metadata-admin to change them/);
  });

  it('CONTROL — the same radio with one option saves, carried through with its option', async () => {
    await relabelUnrelatedField({ vote: { type: 'radio', label: 'Vote', options: [{ label: 'Yes', value: 'yes' }] } });

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body.fields.vote).toEqual({ type: 'radio', label: 'Vote', options: [{ label: 'Yes', value: 'yes' }] });
    expect(puts[0].body.fields.name).toEqual(expect.objectContaining({ label: 'Renamed by the author' }));
    expect(screen.queryByTestId('metadata-fields-page-error')).toBeNull();
  });
});
