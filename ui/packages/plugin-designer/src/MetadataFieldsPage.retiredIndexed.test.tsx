/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4644 — the Field Designer's save never carries a field-level
 * `indexed`, whatever the stored object holds.
 *
 * `indexed` is not a `FieldSchema` key and never was: the field-level flag
 * built no index (objectstack#2377 removed it) and, since objectstack#4001
 * closed the silent-drop shape, `FieldSchema.safeParse` refuses it by name.
 * Measured on 17.0.0 GA, a PUT carrying it comes back
 *
 *   HTTP 422 {"code":"INVALID_METADATA","error":"… fields.owner_id:
 *     Unrecognized key(s) on this field: `indexed`. …"}
 *
 * and — because the key is stored, not merely typed — every LATER save of that
 * object fails the same way until someone clears it by hand. The real surface
 * is object-level `indexes: [{ name, fields, unique }]`, which this page
 * already preserves untouched.
 *
 * Two directions are pinned, because dropping the drawer's `Indexed` checkbox
 * is only half of it:
 *   - what the designer emits, so the key cannot re-enter through a save;
 *   - a save of an object ALREADY carrying `indexed` in its stored fields —
 *     `fromDesignerField` spreads the previous server def verbatim to preserve
 *     unknown keys, and would otherwise hand the key straight back to the
 *     route that rejects it.
 *
 * Written against the wire like its sibling `MetadataFieldsPage.saveEnvelope`
 * test: a REAL `MetadataClient` over a fetch double, assertions on the captured
 * PUT bytes rather than on the argument handed to the client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';

/**
 * The object document as it lives in the database — `owner_id` carries the
 * key an older console wrote, `indexes` carries the object-level surface that
 * actually builds indexes. A save must drop the first and keep the second.
 *
 * `owner_id` also carries a `reference`, which this file makes no claim about:
 * it is a `lookup`, and objectui#7714 refuses a relationship field with no
 * target BEFORE the PUT, so without one every save here would be refused by a
 * guard that is not this file's subject. Supplying it is a declaration the
 * fixture always owed — `{ type: 'lookup' }` with no target has never been a
 * document `@objectstack/spec` 17.3.0 would accept.
 */
const OBJECT_BODY = {
  name: 'probe_widget',
  label: 'Widget',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    owner_id: { type: 'lookup', label: 'Owner', reference: 'account', indexed: true, helpText: 'Record owner.' },
    code: { type: 'text', label: 'Code', indexed: false },
  },
  indexes: [{ name: 'by_owner', fields: ['owner_id'] }],
};

const OBJECT_ENVELOPE = {
  type: 'object',
  name: 'probe_widget',
  item: OBJECT_BODY,
  lock: 'none',
  provenance: 'org',
  editable: true,
};

interface RecordedDesignerProps {
  objectName: string;
  fields: DesignerFieldDefinition[];
  onFieldsChange?: (fields: DesignerFieldDefinition[]) => void;
  readOnly?: boolean;
}

let designerProps: RecordedDesignerProps | null = null;

vi.mock('./FieldDesigner', () => ({
  FieldDesigner: (props: RecordedDesignerProps) => {
    designerProps = props;
    return null;
  },
}));

import { MetadataFieldsPage } from './MetadataFieldsPage';

let puts: Array<Record<string, unknown>> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return json({ success: true, name: 'probe_widget' });
      }
      if (/\/meta\/object\/probe_widget(\?|$)/.test(url)) return json(OBJECT_ENVELOPE);
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

async function renderPage() {
  render(<MetadataFieldsPage objectName="probe_widget" client={realClient()} />);
  await waitFor(() => expect(designerProps).not.toBeNull());
}

/** The body of the last PUT, exactly as it went over the wire. */
function lastPut(): Record<string, unknown> {
  // Indexed rather than `.at(-1)`: `Array.prototype.at` is ES2022, and this
  // package's own `tsconfig.test.json` owns the `lib` level that decides
  // whether it type-checks — read that off the `lib` section of
  // `pnpm census:tsconfig-test-parity`. ⛔ Don't restate its answer here: the
  // sentence this replaces did, and went false the moment the level moved
  // (objectui#9513). Index arithmetic asks no `lib` question at all.
  return puts[puts.length - 1];
}

/** The fields map exactly as it went over the wire on the last PUT. */
function savedFields(): Record<string, Record<string, unknown>> {
  return lastPut().fields as Record<string, Record<string, unknown>>;
}

beforeEach(() => {
  puts = [];
  designerProps = null;
});

afterEach(() => {
  designerProps = null;
});

describe('objectui#4644 · the Field Designer never saves a field-level `indexed`', () => {
  it('does not hand the stored `indexed` down to the designer', async () => {
    await renderPage();
    const owner = designerProps!.fields.find((f) => f.name === 'owner_id')!;
    expect('indexed' in owner).toBe(false);
    // Falsification: the field itself arrived, with its live keys intact.
    expect(owner.label).toBe('Owner');
    expect(owner.type).toBe('lookup');
  });

  it('a save of an object already carrying `indexed` puts it back without the key', async () => {
    await renderPage();
    // A plain relabel — the smallest edit that re-serialises every field.
    const next = designerProps!.fields.map((f) =>
      f.name === 'owner_id' ? { ...f, label: 'Record owner' } : f,
    );
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    const fields = savedFields();
    expect('indexed' in fields.owner_id).toBe(false);
    // `indexed: false` is rejected exactly as `true` is — `unrecognized_keys`
    // fires on the key's presence, so a falsy stored value blocks saves too.
    expect('indexed' in fields.code).toBe(false);
    // Falsification, three ways: the edit landed; the unknown per-field key
    // the designer does not render survived; and the object-level index
    // surface — the thing that actually builds an index — is untouched.
    expect(fields.owner_id.label).toBe('Record owner');
    expect(fields.owner_id.helpText).toBe('Record owner.');
    expect(lastPut().indexes).toEqual([{ name: 'by_owner', fields: ['owner_id'] }]);
  });

  it('a field the designer newly emits carries no `indexed` either', async () => {
    await renderPage();
    const next: DesignerFieldDefinition[] = [
      ...designerProps!.fields,
      { id: 'fld_new', name: 'amount', label: 'Amount', type: 'currency' },
    ];
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    const fields = savedFields();
    expect(Object.values(fields).some((d) => 'indexed' in d)).toBe(false);
    expect(fields.amount).toMatchObject({ type: 'currency', label: 'Amount' });
  });
});
