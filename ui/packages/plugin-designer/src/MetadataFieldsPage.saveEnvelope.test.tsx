/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4546 — the Field Designer's SAVE body is pinned to the object body.
 *
 * `MetadataFieldsPage` reads an object through `MetadataClient.get()` and then
 * writes it straight back:
 *
 *     client.save('object', name, { ...state.raw, fields: nextFields })
 *
 * so whatever shape `get()` hands back is the shape that lands in the database.
 * Before objectui#4271 / PR #4545, `get()` returned the SERVER ENVELOPE
 * (`{ type, name, item, …ADR-0010 protection carriers }`) while its docblock
 * promised the unwrapped body — which made a routine field edit persist the
 * envelope OVER the object. That was the highest-severity consumer in #4545's
 * census: silent data corruption on a save, not merely an empty render.
 *
 * #4545 repaired the contract at the producer, so this page was healed without
 * being edited — and therefore nothing pins the save path's WIRE SHAPE. That is
 * what this file is for. It is deliberately written the way #4545's suite is:
 *
 *   - a REAL `MetadataClient`, constructed here and passed in as the page's
 *     `client` prop. Nothing mocks `get()`, `save()`, or anything else on it;
 *   - a fetch double answering the REAL server shapes — the single-item read
 *     answers the envelope objectstack#5563 collapsed that route to, not the
 *     bare `{ fields }` body the repo's older doubles invented from the
 *     docblock (writing doubles against documentation instead of the wire is
 *     exactly how this defect hid inside 3,628 green tests);
 *   - assertions on the captured PUT body, i.e. the bytes, not on the argument
 *     the page handed the client.
 *
 * `FieldDesigner` — the presentational leaf — is the only double, and it is a
 * prop recorder. The unit under test is the page's read/merge/save chain, which
 * runs for real; the grid-and-drawer UI that produces the edit is not where the
 * corruption lives. (Same shape as #4545's `PermissionAdvancedFacets` stub.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';

// ---------------------------------------------------------------------------
// Fixtures — the wire, both directions
// ---------------------------------------------------------------------------

/**
 * The object document as it lives in the database: the thing a save must put
 * back. `indexes` / `hooks` are keys the designer knows nothing about, and
 * `fields.stage.helpText` is a per-field key it knows nothing about — the
 * container's docblock promises both survive a field edit, so they are part of
 * the pin.
 */
const OBJECT_BODY = {
  name: 'showcase_project',
  label: 'Project',
  description: 'A customer project.',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    // One option: a `select` with no option source is held by the object write
    // guard (objectui#11253), which is not what this file measures.
    stage: { type: 'select', label: 'Stage', helpText: 'Pipeline stage.', options: [{ label: 'Open', value: 'open' }] },
    amount: { type: 'currency', label: 'Amount' },
  },
  indexes: [{ name: 'by_stage', fields: ['stage'] }],
  hooks: { beforeInsert: 'stampOwner' },
};

/**
 * Exactly what `GET /api/v1/meta/object/showcase_project` answers (200) —
 * `GetMetaItemResponseSchema`: the identity pair plus the `item` slot, plus the
 * ADR-0010 protection carriers spread alongside them.
 */
const OBJECT_ENVELOPE = {
  type: 'object',
  name: 'showcase_project',
  item: OBJECT_BODY,
  lock: 'none',
  lockReason: '',
  lockSource: 'artifact',
  lockDocsUrl: 'https://docs.objectstack.ai/locks',
  provenance: 'org',
  packageId: 'app.showcase',
  packageVersion: '1.4.0',
  editable: true,
  deletable: true,
  resettable: false,
};

/**
 * Every key that belongs to the RESPONSE ENVELOPE and to nothing else — the
 * `item` slot plus the ADR-0010 carriers `MetadataLayered` declares. Measured
 * off `packages/data-objectstack/src/metadata-client.ts` (the protection
 * envelope block) and #4545's `A2` fixture, not guessed.
 *
 * `name` is deliberately NOT here: the envelope's `name` and the body's `name`
 * carry the same string, which is precisely why `name` can never detect this
 * corruption. `type` is handled separately below — it is the envelope's
 * discriminator, and an object document has no top-level `type` of its own
 * (a view does, which is why the general rule is the identity TRIPLE and not
 * `type` alone).
 */
const ENVELOPE_ONLY_KEYS = [
  'item',
  'lock',
  'lockReason',
  'lockSource',
  'lockDocsUrl',
  'provenance',
  'packageId',
  'packageVersion',
  'editable',
  'deletable',
  'resettable',
  '_diagnostics',
] as const;

/**
 * The envelope-identity test `MetadataClient` itself uses (`isMetaItemEnvelope`):
 * a `type` string, a `name` string, and an `item` slot. A saved body that
 * answers `true` here IS the envelope, whatever else it also carries.
 */
function looksLikeTheResponseEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === 'string' && typeof v.name === 'string' && 'item' in v;
}

/** The edit the designer emits: rename `stage`, mark it required, keep the rest. */
const EDITED_FIELDS: DesignerFieldDefinition[] = [
  { id: 'name', name: 'name', label: 'Name', type: 'text', required: true },
  { id: 'stage', name: 'stage', label: 'Pipeline stage', type: 'select', required: true },
  { id: 'amount', name: 'amount', label: 'Amount', type: 'currency' },
];

// ---------------------------------------------------------------------------
// The one double: the presentational leaf, recording its props
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// A real MetadataClient over a fetch that speaks the framework's shapes
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string;
  url: string;
  /** The PUT payload as it went over the wire, parsed back from the bytes. */
  body: Record<string, unknown>;
}

let puts: CapturedRequest[] = [];
let getCount = 0;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Nothing here mocks the client — this is the transport underneath a real one. */
function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push({
          method,
          url,
          body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        });
        return json({ success: true, name: 'showcase_project' });
      }
      if (/\/meta\/object\/showcase_project(\?|$)/.test(url)) {
        getCount += 1;
        // The ONE shape objectstack#5563 left standing for a single-item read.
        return json(OBJECT_ENVELOPE);
      }
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

async function renderPage() {
  render(<MetadataFieldsPage objectName="showcase_project" client={realClient()} />);
  await waitFor(() => expect(designerProps).not.toBeNull());
}

/** Drive the designer's `onFieldsChange` and wait for the PUT it triggers. */
async function saveFields(next: DesignerFieldDefinition[], expectedPuts = 1) {
  await act(async () => {
    designerProps!.onFieldsChange!(next);
  });
  await waitFor(() => expect(puts).toHaveLength(expectedPuts));
}

beforeEach(() => {
  puts = [];
  getCount = 0;
  designerProps = null;
});

afterEach(() => {
  designerProps = null;
});

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

describe('objectui#4546 · the Field Designer saves the object BODY, never the response envelope', () => {
  it('S0 (control): a field edit fires exactly one PUT at the object’s own route', async () => {
    // Green whichever contract `get()` honors — the envelope defect moves the
    // BODY only, never the route, the verb, or whether a save happens at all.
    // Its job is to prove S1–S4's red is about the payload rather than about a
    // save that silently never fired.
    await renderPage();
    await saveFields(EDITED_FIELDS);

    expect(puts).toHaveLength(1);
    expect(puts[0].method).toBe('PUT');
    expect(puts[0].url).toBe('http://localhost:3000/api/v1/meta/object/showcase_project');
    expect(typeof puts[0].body).toBe('object');
  });

  it('S1: the PUT body IS the object body, with the edited fields merged in', async () => {
    await renderPage();
    await saveFields(EDITED_FIELDS);

    const { fields, ...rest } = puts[0].body as {
      fields: Record<string, Record<string, unknown>>;
    } & Record<string, unknown>;

    // Everything that is not `fields` must be the object document, exactly —
    // an exhaustive check, so ANY stray envelope key fails here without having
    // to be named in advance.
    expect(rest).toEqual({
      name: 'showcase_project',
      label: 'Project',
      description: 'A customer project.',
      indexes: [{ name: 'by_stage', fields: ['stage'] }],
      hooks: { beforeInsert: 'stampOwner' },
    });

    // The edit itself landed, on the object's own field map.
    expect(Object.keys(fields)).toEqual(['name', 'stage', 'amount']);
    expect(fields.stage).toMatchObject({
      type: 'select',
      label: 'Pipeline stage',
      required: true,
      // A per-field key the designer knows nothing about. It survives only
      // because the merge read the OBJECT's field map for `prev`; against the
      // envelope there is no `fields` map to read and this is silently lost.
      helpText: 'Pipeline stage.',
    });
  });

  it('S2: the saved body carries no envelope key and is not itself envelope-shaped', async () => {
    await renderPage();
    await saveFields(EDITED_FIELDS);

    const body = puts[0].body;

    // Named one by one, so a failure says WHICH carrier leaked.
    for (const key of ENVELOPE_ONLY_KEYS) {
      expect({ key, present: key in body }).toEqual({ key, present: false });
    }
    // The envelope's discriminator. An object document has no top-level `type`.
    expect('type' in body).toBe(false);

    // …and the whole-shape test: by the client's own definition, this is not
    // an envelope.
    expect(looksLikeTheResponseEnvelope(body)).toBe(false);
    // The corruption's signature, stated positively: a real object body has a
    // reachable field map.
    expect(Object.keys((body as { fields: Record<string, unknown> }).fields)).toHaveLength(3);
  });

  it('S3: the designer is handed the object’s real fields, not an envelope’s empty ones', async () => {
    // The read half of the same defect: against the envelope, `raw.fields` is
    // `undefined` and the designer renders an object with zero fields — which
    // is also what turns the very next save into a total field wipe.
    await renderPage();

    expect(designerProps!.objectName).toBe('showcase_project');
    expect(designerProps!.fields.map((f) => f.name)).toEqual(['name', 'stage', 'amount']);
    expect(designerProps!.fields.find((f) => f.name === 'amount')?.type).toBe('currency');
  });

  it('S4: the save after the post-save reload is still the body', async () => {
    // A save reloads the object through the same `get()`, so the SECOND edit
    // rides on a freshly-read `state.raw`. If the read regressed, the first
    // save could be clean and every later one corrupt.
    await renderPage();
    await saveFields(EDITED_FIELDS);
    await waitFor(() => expect(getCount).toBe(2));
    // Let the reload's state update commit, so the second edit rides on a
    // freshly-read `state.raw`. Deliberately NOT a wait on the field list
    // arriving: that would make this case fail during setup instead of at its
    // own assertion whenever the read regresses, hiding the shape it is here
    // to pin.
    await act(async () => {
      await Promise.resolve();
    });

    await saveFields(
      [...EDITED_FIELDS, { id: 'region', name: 'region', label: 'Region', type: 'text' }],
      2,
    );

    const second = puts[1].body;
    for (const key of ENVELOPE_ONLY_KEYS) {
      expect({ key, present: key in second }).toEqual({ key, present: false });
    }
    expect(looksLikeTheResponseEnvelope(second)).toBe(false);
    expect(second.label).toBe('Project');
    expect(Object.keys((second as { fields: Record<string, unknown> }).fields)).toEqual([
      'name',
      'stage',
      'amount',
      'region',
    ]);
  });
});
