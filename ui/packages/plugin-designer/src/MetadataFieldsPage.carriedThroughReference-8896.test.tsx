/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8896 — the CARRIED-THROUGH half loses a target stored only as
 * `referenceTo`, and the loss refuses the whole save.
 *
 * ## The path, and why no read door stands in front of it
 *
 * objectui#8060 split the stored `fields` map: a field whose stored `type`
 * this designer cannot author (`master_detail`, `vector`, the other 20) is
 * PRESERVED and re-emitted straight from the stored document as
 * `carryOver(keep.raw)`. `toDesignerField` — the read door — is on the
 * DESIGNABLE branch only, so nothing on this path ever looks at the stored
 * field's keys before `carryOver` strips them.
 *
 * `carryOver` strips `referenceTo` (the registry's `metadataFieldsPageCarryOver`
 * site, objectui#6041/#6527), because `FieldSchema` refuses that spelling BY
 * NAME and re-emitting it is the hard 422 that blocks every later save. So for
 * a stored `master_detail` whose target survives ONLY under the retired
 * spelling, the strip takes the target with it, and objectui#7714's
 * `assertRelationshipTargetPresent` then refuses the ENTIRE save:
 *
 *   stored { parent_id: { type: 'master_detail', label: 'Parent',
 *                         referenceTo: 'invoice' } }
 *   author relabels an UNRELATED `name` field
 *     => puts = []   (no PUT at all)
 *     => "[MetadataFieldsPage] cannot save the field `parent_id`: a
 *         `master_detail` field needs a `reference` naming the object it links
 *         to, … Pick the target object, or change the field to a
 *         non-relationship type."
 *
 * ⭐ The consequence, which is what makes this worth a card: the author edited
 * a DIFFERENT field. A preserved field is rendered READ-ONLY on this page by
 * design (objectui#8060), so "Pick the target object" names a control that does
 * not exist here — every later save of that object is refused from this page
 * with no way out of it from this page.
 *
 * ## The repair, and the two things it deliberately does NOT do
 *
 * ⛔ NOT loosening `assertRelationshipTargetPresent`. The gate is right: a
 * `master_detail` really does need a target, and a genuinely target-less one
 * must stay refused — pinned below as this file's firing control, so a build
 * that simply removed the gate reds instead of passing.
 *
 * ⛔ NOT emitting `referenceTo`. That spelling is `unrecognized_keys` against
 * the installed `FieldSchema`, so carrying the KEY out to the wire re-creates
 * the 422 the strip exists to prevent. The VALUE is recovered into the spec
 * spelling `reference`; the retired key still never reaches the wire.
 *
 * This is the same shape the designable half already uses — read the target
 * wherever the stored document put it, write it under the one spelling the spec
 * declares — and it is the SAME reader: both halves now go through
 * `storedRelationshipTarget`, the function objectui#8058 added and argued. One
 * spelling rule, stated once, for the two branches of one writer.
 *
 * ⚠️ Scope: this file drives the PRESERVED branch only, with a stored type
 * (`master_detail`) `DESIGNER_FIELD_TYPES` does not carry. The designable
 * half's read door landed as objectui#8058 and is not re-opened here — its pins
 * in `MetadataFieldsPage.specKeyReference.test.tsx` still own that state and
 * must stay green.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { FieldSchema } from '@objectstack/spec/data';
import { MetadataClient } from '@object-ui/data-objectstack';
import { DESIGNER_FIELD_TYPES } from '@object-ui/types';
import type { DesignerFieldDefinition } from '@object-ui/types';

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

function clientServing(fields: Record<string, Record<string, unknown>>): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return json({ success: true, name: 'probe_widget' });
      }
      if (/\/meta\/object\/probe_widget(\?|$)/.test(url)) {
        return json({
          type: 'object',
          name: 'probe_widget',
          item: { name: 'probe_widget', label: 'Widget', fields },
          lock: 'none',
          provenance: 'org',
          editable: true,
        });
      }
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

async function renderServing(fields: Record<string, Record<string, unknown>>) {
  render(<MetadataFieldsPage objectName="probe_widget" client={clientServing(fields)} />);
  await waitFor(() => expect(designerProps).not.toBeNull());
}

/** A plain relabel of an UNRELATED field — the author never touches the lookup. */
async function relabelUnrelated() {
  await act(async () => {
    designerProps!.onFieldsChange!(
      designerProps!.fields.map((f) => (f.name === 'name' ? { ...f, label: 'Full name' } : f)),
    );
  });
}

function savedFields(): Record<string, Record<string, unknown>> {
  return puts[puts.length - 1].fields as Record<string, Record<string, unknown>>;
}

const unrecognizedKeys = (result: ReturnType<typeof FieldSchema.safeParse>): string[] =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => (i as unknown as { keys: string[] }).keys);

beforeEach(() => {
  puts = [];
  designerProps = null;
});

afterEach(() => {
  cleanup();
  designerProps = null;
});

describe('the instrument', () => {
  it('`master_detail` is a stored type this designer cannot author — so it takes the PRESERVED branch', () => {
    // If this ever became authorable the whole file would silently move to the
    // designable branch and stop testing what it is named for.
    expect((DESIGNER_FIELD_TYPES as readonly string[]).includes('master_detail')).toBe(false);
  });

  it('the installed `FieldSchema` refuses `referenceTo` by name and accepts `reference`', () => {
    expect(unrecognizedKeys(FieldSchema.safeParse({ type: 'master_detail', label: 'P', referenceTo: 'invoice' })))
      .toContain('referenceTo');
    expect(FieldSchema.safeParse({ type: 'master_detail', label: 'P', reference: 'invoice' }).success).toBe(true);
  });
});

describe('objectui#8896 · a preserved `master_detail` whose target survives only as `referenceTo`', () => {
  const STORED = {
    name: { type: 'text', label: 'Name', required: true },
    parent_id: { type: 'master_detail', label: 'Parent', referenceTo: 'invoice' },
  };

  it('saves — the unrelated edit goes out instead of being refused', async () => {
    await renderServing(STORED);
    await relabelUnrelated();
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(screen.queryByTestId('metadata-fields-page-error')).toBeNull();
  });

  it('carries the target through, under the spec spelling and never the retired one', async () => {
    await renderServing(STORED);
    await relabelUnrelated();
    await waitFor(() => expect(puts).toHaveLength(1));

    const fields = savedFields();
    expect(fields.parent_id.reference).toBe('invoice');
    expect('referenceTo' in fields.parent_id).toBe(false);
    // Falsification: the field is still carried through whole — the stored type
    // survives, and the author's actual edit landed.
    expect(fields.parent_id.type).toBe('master_detail');
    expect(fields.parent_id.label).toBe('Parent');
    expect(fields.name.label).toBe('Full name');
  });

  it('every field it PUTs parses through the real FieldSchema', async () => {
    await renderServing(STORED);
    await relabelUnrelated();
    await waitFor(() => expect(puts).toHaveLength(1));

    for (const [name, def] of Object.entries(savedFields())) {
      const result = FieldSchema.safeParse(def);
      expect(unrecognizedKeys(result), `field \`${name}\` emitted a refused key`).toEqual([]);
      expect(result.success, `field \`${name}\` did not parse`).toBe(true);
    }
  });
});

/**
 * ⭐ The firing control. Without it every assertion above would also pass on a
 * build that simply deleted `assertRelationshipTargetPresent` — which is the
 * one repair this card forbids.
 */
describe('objectui#8896 · firing control — a genuinely target-less preserved field is STILL refused', () => {
  it('refuses by name and issues no PUT when no spelling carries a target', async () => {
    await renderServing({
      name: { type: 'text', label: 'Name', required: true },
      parent_id: { type: 'master_detail', label: 'Parent' },
    });
    await relabelUnrelated();

    await waitFor(() =>
      expect(screen.getByTestId('metadata-fields-page-error').textContent).toMatch(
        /cannot save the field `parent_id`: a `master_detail` field needs a `reference`/,
      ),
    );
    expect(puts).toEqual([]);
  });

  it('refuses a preserved field whose retired spelling holds an unusable value', async () => {
    // The carry-through adopts what the document HOLDS and judges nothing — the
    // same division of labour the designable half has: `storedRelationshipTarget`
    // decides the SPELLING, `assertRelationshipTargetPresent` decides whether the
    // value can be a target. So a whitespace-only retired target arrives as the
    // emitted `reference` and is refused on the guard's own blank branch, by
    // name and before the request, rather than being smuggled through as "a
    // target was found".
    await renderServing({
      name: { type: 'text', label: 'Name', required: true },
      parent_id: { type: 'master_detail', label: 'Parent', referenceTo: '   ' },
    });
    await relabelUnrelated();

    await waitFor(() =>
      expect(screen.getByTestId('metadata-fields-page-error').textContent).toMatch(
        /cannot save the field `parent_id`.*whitespace names no object/s,
      ),
    );
    expect(puts).toEqual([]);
  });
});
