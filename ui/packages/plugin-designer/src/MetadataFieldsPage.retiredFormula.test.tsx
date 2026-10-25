/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6043 — the Field Designer never puts `formula` on the wire, and does
 * not rename it to `expression` either.
 *
 * Surfaced by the key-level parity gate built for objectui#5761
 * (`scripts/check-designer-field-key-parity.mjs`). `ServerFieldSchema` is one of
 * that gate's two `wire` shapes: `fromDesignerField` builds it and this page
 * PUTs the assembled `fields` map.
 *
 * `formula` is not in `FieldSchema`'s accept set. Measured against the installed
 * `@objectstack/spec` 17.2.0:
 *
 *   FieldSchema.safeParse({ type:'formula', label:'Tax', formula:'price * quantity' })
 *     => success = false
 *     => unrecognized_keys ['formula']
 *        "Did you mean `formula` -> `expression`?"
 *
 * i.e. a hard 422 `INVALID_METADATA` that blocks every later save of the object.
 *
 * ## Why this card did NOT take its siblings' shape
 *
 * `referenceTo` (objectui#6041) and `isSystem` (objectui#6044) were renames: the
 * spec had an accepted spelling for the same value, so the emit site moved and
 * nothing was lost. The spec has a spelling here too — `expression` — and this
 * card refused to use it. The reason is measurable, and the control below pins
 * it so a later reader cannot mistake the refusal for an oversight:
 *
 *   FieldSchema.safeParse({ type:'formula', expression:'!!!not cel at all!!!' })
 *     => success = TRUE
 *
 * `FieldSchema` validates the KEY, never the expression LANGUAGE. `expression`
 * is CEL rooted at `record`, while the retired control's own placeholder taught
 * `price * quantity` — bare field refs, which `celAuthoring.ts` records as
 * silently evaluating to null at runtime under the scope formulas bind. So a
 * rename would have moved the failure from a loud, immediate 422 to a formula
 * that saves clean and then quietly computes nothing. The control was removed
 * instead; expressions are authored in metadata-admin's `ObjectFieldInspector`,
 * where the real `@objectstack/formula` engine lints them.
 *
 * Written against the wire like its siblings `MetadataFieldsPage.saveEnvelope`
 * and `MetadataFieldsPage.specKeyReference`: a REAL `MetadataClient` over a
 * fetch double, assertions on the captured PUT bytes rather than on the argument
 * handed to the client. That distinction is load-bearing here — a property whose
 * value is `undefined` is a key zod's strict object COUNTS but `JSON.stringify`
 * DROPS, so an in-memory assertion and a wire assertion disagree on exactly the
 * fields this card touches.
 *
 * This file names no `reference`/`referenceTo` or `system`/`isSystem` key: the
 * cards of this family are independently verifiable, and reverting one fix must
 * red only its own file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { FieldSchema } from '@objectstack/spec/data';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';

/**
 * The object document as it lives in the database.
 *
 *   `total` carries what a SPEC-PARSED SERVER sends for a formula field —
 *   `expression` plus `returnType`, neither of which this page renders a
 *   control for. Both must survive an edit-and-save here untouched.
 *   `legacy_total` carries the refused key a pre-fix designer build wrote.
 *   `carryOver` spreads the previous server def verbatim, so without a
 *   tombstone the key rides straight back out to the route that rejects it —
 *   and the object stays blocked forever, with the control that could once
 *   clear it now gone.
 */
const OBJECT_BODY = {
  name: 'probe_invoice',
  label: 'Invoice',
  fields: {
    amount: { type: 'number', label: 'Amount' },
    total: {
      type: 'formula',
      label: 'Total',
      expression: 'record.amount * 0.2',
      returnType: 'number',
    },
    legacy_total: { type: 'formula', label: 'Legacy Total', formula: 'price * quantity' },
  },
};

const OBJECT_ENVELOPE = {
  type: 'object',
  name: 'probe_invoice',
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
        return json({ success: true, name: 'probe_invoice' });
      }
      if (/\/meta\/object\/probe_invoice(\?|$)/.test(url)) return json(OBJECT_ENVELOPE);
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

async function renderPage() {
  render(<MetadataFieldsPage objectName="probe_invoice" client={realClient()} />);
  await waitFor(() => expect(designerProps).not.toBeNull());
}

/** The fields map exactly as it went over the wire on the last PUT. */
function savedFields(): Record<string, Record<string, unknown>> {
  return puts[puts.length - 1].fields as Record<string, Record<string, unknown>>;
}

const unrecognizedKeys = (result: ReturnType<typeof FieldSchema.safeParse>): string[] =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => (i as unknown as { keys: string[] }).keys);

/** A plain relabel — the smallest edit that re-serialises every field. */
async function relabel(fieldName: string, label: string) {
  const next = designerProps!.fields.map((f) => (f.name === fieldName ? { ...f, label } : f));
  await act(async () => {
    designerProps!.onFieldsChange!(next);
  });
  await waitFor(() => expect(puts).toHaveLength(1));
}

beforeEach(() => {
  puts = [];
  designerProps = null;
});

afterEach(() => {
  designerProps = null;
});

describe('the instrument', () => {
  it('is the installed spec schema and it is STRICT — unknown keys are refused, not stripped', () => {
    // objectstack#4001 closed the silent-drop shape. Without it every parity
    // assertion here would be trivially green while the 422 still happened.
    const result = FieldSchema.safeParse({ type: 'text', label: 'L', zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });

  it('refuses `formula` by name — the state this file keeps off the wire', () => {
    expect(
      unrecognizedKeys(FieldSchema.safeParse({ type: 'formula', label: 'Tax', formula: 'price * quantity' })),
    ).toEqual(['formula']);
  });

  it('accepts the field TYPE `formula` — only the expression key was refused', () => {
    // Load-bearing: the fix removes a CONTROL, not a field type. If the type
    // were refused too the card's shape would have been different, and this
    // assertion is what makes that claim checkable rather than assumed.
    expect(FieldSchema.safeParse({ type: 'formula', label: 'Tax' }).success).toBe(true);
  });

  it('accepts `expression` WITHOUT parsing the CEL in it — why the rename was refused', () => {
    // The card's establishing argument, as an executable fact. `FieldSchema`
    // is a key-name oracle: it cannot tell a formula from a shopping list, so
    // renaming would have bought a green parse for anything at all.
    expect(FieldSchema.safeParse({ type: 'formula', label: 'T', expression: 'record.amount * 0.2' }).success).toBe(true);
    expect(FieldSchema.safeParse({ type: 'formula', label: 'T', expression: 'price * quantity' }).success).toBe(true);
    expect(FieldSchema.safeParse({ type: 'formula', label: 'T', expression: '!!!not cel at all!!!' }).success).toBe(true);
  });
});

describe('objectui#6043 · WRITE — no save carries `formula`, under any spelling', () => {
  it('strips the refused key from an object ALREADY carrying it, unblocking the object', async () => {
    // The case that keeps a blocked object blocked without the tombstone:
    // removing the control does not touch what `carryOver` spreads, so the
    // stored key would ride back out to the same 422 — and with the control
    // gone the author would have no way left to clear it.
    await renderPage();
    await relabel('amount', 'Amount (net)');

    const fields = savedFields();
    expect('formula' in fields.legacy_total).toBe(false);
    // Falsification: the strip removed a KEY, not the field, and did not
    // launder the value into the accepted spelling either — that laundering is
    // precisely what this card refused.
    expect(fields.legacy_total.type).toBe('formula');
    expect(fields.legacy_total.label).toBe('Legacy Total');
    expect('expression' in fields.legacy_total).toBe(false);
    expect(FieldSchema.safeParse(fields.legacy_total).success).toBe(true);
  });

  it('drops a `formula` smuggled onto a designer field instead of emitting it', async () => {
    // `DesignerFieldDefinition` no longer DECLARES `formula`, so this cast is
    // the point rather than a workaround: it proves the converter is closed at
    // RUNTIME, not merely that the type forbids the key. A stale build, a JS
    // caller or a re-added control all reach `fromDesignerField` this way.
    await renderPage();
    const next = designerProps!.fields.map((f) =>
      f.name === 'total' ? ({ ...f, formula: 'price * quantity' } as DesignerFieldDefinition) : f,
    );
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    expect('formula' in savedFields().total).toBe(false);
  });

  it('every field it PUTs parses through the real FieldSchema', async () => {
    await renderPage();
    await relabel('amount', 'Amount (net)');

    for (const [name, def] of Object.entries(savedFields())) {
      const result = FieldSchema.safeParse(def);
      expect(unrecognizedKeys(result), `field \`${name}\` emitted a refused key`).toEqual([]);
      expect(result.success, `field \`${name}\` did not parse`).toBe(true);
    }
  });

  it('a newly authored formula field emits a parseable def with no expression key at all', async () => {
    await renderPage();
    const next: DesignerFieldDefinition[] = [
      ...designerProps!.fields,
      { id: 'fld_new', name: 'tax', label: 'Tax', type: 'formula' },
    ];
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    const tax = savedFields().tax;
    expect('formula' in tax).toBe(false);
    expect('expression' in tax).toBe(false);
    // The field itself is still authored and still saves — removing the control
    // did not remove the ability to declare a field computed.
    expect(tax.type).toBe('formula');
    expect(FieldSchema.safeParse(tax).success).toBe(true);
  });
});

describe('objectui#6043 · READ — an expression authored elsewhere survives this page', () => {
  it('round-trips `expression` and `returnType` untouched', async () => {
    // The read half, in the shape route (B) permits. The card asked whether an
    // existing formula field "loads with its expression populated"; with the
    // control removed there is no box to populate, so the obligation becomes
    // the stronger one: this page must not DESTROY an expression authored in
    // metadata-admin, where the CEL engine checked it.
    //
    // ⚠ This case also passes on a revert, and says so deliberately: `carryOver`
    // already preserved both keys. It is a must-not-change pin, not a two-world
    // assertion — the two-world rows are in the WRITE block above.
    await renderPage();
    await relabel('amount', 'Amount (net)');

    const total = savedFields().total;
    expect(total.expression).toBe('record.amount * 0.2');
    expect(total.returnType).toBe('number');
    expect(FieldSchema.safeParse(total).success).toBe(true);
  });

  it('hands no formula expression down to the designer in any form', async () => {
    await renderPage();
    const total = designerProps!.fields.find((f) => f.name === 'total')!;
    expect('formula' in total).toBe(false);
    // Falsification: the field itself arrived, with its other keys intact, so
    // the absence above is a reader that stopped reading the key — not a field
    // that failed to load.
    expect(total.label).toBe('Total');
    expect(total.type).toBe('formula');
  });
});
