/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8060 — a stored field type this designer cannot author SURVIVES an
 * edit to a different field.
 *
 * ## The defect these pins close
 *
 * `toDesignerType` answered `DesignerFieldType` for every input by returning
 * `'text'` for anything outside `DESIGNER_FIELD_TYPES`, and `toDesignerField`
 * called it on the READ path — so the collapse happened before the author saw
 * anything — while `fromDesignerField` emitted `type: designed.type`, so the
 * collapsed value was written back. Relabelling ONE field rewrote every other
 * field whose type the designer does not author, on the same PUT:
 *
 *     stored  parent_id { type: 'master_detail', reference: 'invoice' }
 *     stored  vec       { type: 'vector' }
 *     relabel the unrelated `name` field
 *       => WIRE parent_id { "type": "text", "reference": "invoice" }
 *       => WIRE vec       { "type": "text" }
 *
 * `text` is a LEGAL spec type, so the PUT succeeded and nothing reported it.
 * That is what separates this from the tombstone family (objectui#6041 /
 * objectui#6043 / objectui#4644), which 422s loudly and leaves the object
 * recoverable: here the save SUCCEEDS and the evidence of what the field was is
 * gone.
 *
 * ## ⭐ Why these pins are driven from a CENSUS and not from a list of two
 *
 * The card confirmed `master_detail` and `vector`. A pin asserting only those
 * two passes on a fix that SPECIAL-CASES those two and leaves every other
 * member flattening — an implementation strictly worse than a general one, and
 * indistinguishable from it at this level. So `CENSUS` below is DERIVED from
 * the two vocabularies at test time and the class pin iterates it. Adding a
 * type to `@objectstack/spec` without teaching this page about it fails here,
 * rather than becoming the next silent data-loss report.
 *
 * ⚠️ A census-driven pin is the classic VACUOUS pin: `for (const t of set)`
 * passes over an empty set, so a mistake that empties the census turns the
 * class pin green while measuring nothing. `C0` asserts the size AND the exact
 * membership, and every iterating pin counts its own iterations and asserts the
 * count — so an emptied census fails in three places instead of passing in one.
 *
 * ## The evidence bar, inherited from the filing
 *
 * The card drove the REAL page with a REAL `MetadataClient` over a fetch double
 * and asserted the CAPTURED PUT BYTES, with an untouched control field in the
 * same document. These pins are held to that: a helper-level unit test of the
 * type predicate would not discharge this card. `FieldDesigner` — the
 * presentational leaf — is the only double, and it is a prop recorder, so the
 * page's read/partition/merge/save chain runs for real.
 *
 * ## The read path is pinned SEPARATELY from the wire, on purpose
 *
 * The collapse happened on the READ path, so a fix applied only at the write
 * path would show the author a text field and then write back the preserved
 * type — a different lie, and one a wire-only pin cannot see. `P2` asserts what
 * the author is SHOWN; `P1` asserts what is WRITTEN.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { CHOICE_TYPES_REQUIRING_OPTIONS, MetadataClient } from '@object-ui/data-objectstack';
import { DESIGNER_FIELD_TYPES } from '@object-ui/types';
import type { DesignerFieldDefinition } from '@object-ui/types';
// The same subpath `MetadataFieldsPage.specKeyReference.test.tsx` already reads
// the spec through. ⚠️ The root export is thin — `FieldType` lives on `/data`,
// and a root import answering `undefined` would be a SPECIFIER problem, not
// evidence the type is absent.
import { FieldType } from '@objectstack/spec/data';

// ---------------------------------------------------------------------------
// The census — derived, never restated
// ---------------------------------------------------------------------------

/** Every field type `@objectstack/spec` declares. */
const SPEC_FIELD_TYPES: readonly string[] = FieldType.options;

/** Every field type the Field Designer can author. */
const DESIGNER_TYPES: readonly string[] = DESIGNER_FIELD_TYPES;

/**
 * The difference set: spec types the designer cannot author, i.e. exactly the
 * types that used to collapse to `'text'`. Each member is a distinct data-loss
 * case.
 */
const CENSUS: readonly string[] = SPEC_FIELD_TYPES.filter((t) => !DESIGNER_TYPES.includes(t));

/**
 * Measured on `@objectstack/spec` 17.3.0 with `DESIGNER_FIELD_TYPES` at 27
 * members. Restated here as a LITERAL so the derivation above cannot quietly
 * answer something else: if either vocabulary moves, this fails and a human
 * reads the new difference rather than inheriting a stale one.
 */
const CENSUS_AT_FILING = [
  'audio', 'avatar', 'checkboxes', 'composite', 'json', 'master_detail',
  'multiselect', 'progress', 'qrcode', 'radio', 'record', 'repeater',
  'richtext', 'secret', 'signature', 'summary', 'tags', 'toggle', 'tree',
  'user', 'vector', 'video',
] as const;

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
// A real MetadataClient over a fetch double
// ---------------------------------------------------------------------------

interface CapturedPut {
  url: string;
  body: { fields: Record<string, Record<string, unknown>> } & Record<string, unknown>;
}

let puts: CapturedPut[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * One option, for the choice fields below: a `select` / `radio` with no option
 * source is held by the object write guard (objectui#11253), which is not what
 * any pin in this file measures.
 */
const OPEN_OPTION = { label: 'Open', value: 'open' };

/**
 * The object document, built per test. `name` is the CONTROL — a designer-owned
 * `text` field, the only one the edit ever touches.
 */
function objectBody(fields: Record<string, Record<string, unknown>>) {
  return {
    name: 'showcase_project',
    label: 'Project',
    fields: { name: { type: 'text', label: 'Name' }, ...fields },
  };
}

/**
 * ⚠️ The client is served from a double and never reaches a relative URL, so
 * nothing in this file can escape to happy-dom's `http://localhost:3000`. No
 * global is stubbed, so there is no `vi.unstubAllGlobals()` ordering to get
 * wrong; `cleanup()` still runs first in `afterEach` out of the same discipline.
 */
function realClient(body: ReturnType<typeof objectBody>): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        return json({ success: true, name: 'showcase_project' });
      }
      if (/\/meta\/object\/showcase_project(\?|$)/.test(url)) {
        // The single-item read answers the ENVELOPE (objectstack#5563).
        return json({ type: 'object', name: 'showcase_project', item: body });
      }
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

async function renderPage(fields: Record<string, Record<string, unknown>>) {
  render(<MetadataFieldsPage objectName="showcase_project" client={realClient(objectBody(fields))} />);
  await waitFor(() => expect(designerProps).not.toBeNull());
}

/**
 * The unrelated edit: relabel the CONTROL field `name` and nothing else. This
 * is the whole point — the author has no reason to inspect the other fields.
 */
async function relabelControlOnly() {
  const next = designerProps!.fields.map((f) =>
    f.name === 'name' ? { ...f, label: 'Renamed by the author' } : f,
  );
  await act(async () => {
    designerProps!.onFieldsChange!(next);
  });
  await waitFor(() => expect(puts).toHaveLength(1));
  return puts[0].body.fields;
}

beforeEach(() => {
  puts = [];
  designerProps = null;
});

afterEach(() => {
  cleanup();
  designerProps = null;
});

// ---------------------------------------------------------------------------
// C0 — the census itself, and the vacuity guard
// ---------------------------------------------------------------------------

describe('objectui#8060 · C0 the census', () => {
  it('is non-empty, is exactly the 22 measured members, and is the SPEC minus the DESIGNER set', () => {
    expect(SPEC_FIELD_TYPES).toHaveLength(49);
    expect(DESIGNER_TYPES).toHaveLength(27);

    // ⚠️ The vacuity guard. Every iterating pin below is green over an empty
    // set; these three lines are what makes an emptied census fail loudly.
    expect(CENSUS.length).toBeGreaterThan(0);
    expect(CENSUS).toHaveLength(22);
    expect([...CENSUS].sort()).toEqual([...CENSUS_AT_FILING]);

    // Why direction 1 (preserve + read-only) is viable at all: the designer's
    // vocabulary is a strict SUBSET of the spec's, so nothing it can author is
    // unknown to the spec, and 27 + 22 = 49 accounts for every declared type.
    expect(DESIGNER_TYPES.filter((t) => !SPEC_FIELD_TYPES.includes(t))).toEqual([]);
    expect(DESIGNER_TYPES.length + CENSUS.length).toBe(SPEC_FIELD_TYPES.length);
  });
});

// ---------------------------------------------------------------------------
// P1 — the CLASS pin, on the wire
// ---------------------------------------------------------------------------

describe('objectui#8060 · P1 every census member survives an edit to a different field', () => {
  it('round-trips its stored type through the PUT bytes, with the control field untouched', async () => {
    let checked = 0;

    for (const storedType of CENSUS) {
      puts = [];
      designerProps = null;
      // `master_detail` is one of the two relationship types the spec requires
      // a `reference` on, so the fixture gives it one — otherwise this pin
      // would be measuring the target guard instead of the type.
      const probe: Record<string, unknown> = { type: storedType, label: 'Probe' };
      if (storedType === 'master_detail') probe.reference = 'invoice';
      // objectui#11253 — the same reasoning for a choice type: the write guard
      // holds a `select` / `radio` with no option source, so the fixture gives
      // it one rather than measure that guard here.
      if (CHOICE_TYPES_REQUIRING_OPTIONS.includes(storedType)) probe.options = [OPEN_OPTION];

      await renderPage({ probe });
      const wire = await relabelControlOnly();

      // ⚠️ Concrete, distinguishable strings on both sides. `undefined ===
      // undefined` would prove nothing, and `'text'` is what the defect wrote.
      expect(wire.probe, `${storedType}: the field must reach the wire at all`).toBeDefined();
      expect(wire.probe.type, `${storedType} must not be rewritten`).toBe(storedType);
      expect(wire.probe.type, `${storedType} must not collapse to text`).not.toBe('text');
      expect(wire.probe.label, `${storedType}: the untouched field keeps its label`).toBe('Probe');
      if (storedType === 'master_detail') {
        expect(wire.probe.reference, 'the relationship target survives too').toBe('invoice');
      }

      // The control: the edit really happened, so a green above is not a green
      // produced by a save that never fired.
      expect(wire.name.label, `${storedType}: the control field was edited`).toBe('Renamed by the author');
      expect(wire.name.type, `${storedType}: the control field is still text`).toBe('text');

      checked += 1;
      cleanup();
    }

    // The vacuity guard, restated where the iteration happens.
    expect(checked).toBe(22);
    expect(checked).toBe(CENSUS.length);
  });
});

// ---------------------------------------------------------------------------
// P2 — the READ path: what the author is SHOWN
// ---------------------------------------------------------------------------

describe('objectui#8060 · P2 the author is shown the real stored type', () => {
  it('lists the carried-through fields with their stored type, and never as editable text fields', async () => {
    await renderPage({
      parent_id: { type: 'master_detail', label: 'Parent', reference: 'invoice' },
      vec: { type: 'vector', label: 'Vec' },
    });

    // Shown: the real types, by name, as concrete distinguishable strings.
    expect(screen.getByTestId('metadata-fields-page-preserved-type-parent_id').textContent)
      .toBe('master_detail');
    expect(screen.getByTestId('metadata-fields-page-preserved-type-vec').textContent)
      .toBe('vector');

    // NOT shown as editable text fields — the half of the lie a wire-only pin
    // cannot see. The designer's own list holds the control field alone.
    const designed = designerProps!.fields;
    expect(designed.map((f) => f.name)).toEqual(['name']);
    expect(designed.find((f) => f.name === 'parent_id')).toBeUndefined();
    expect(designed.find((f) => f.name === 'vec')).toBeUndefined();
  });

  it('renders no carried-through section at all when every stored type is authorable', async () => {
    await renderPage({ stage: { type: 'select', label: 'Stage' } });

    expect(screen.queryByTestId('metadata-fields-page-preserved')).toBeNull();
    expect(designerProps!.fields.map((f) => f.name)).toEqual(['name', 'stage']);
  });
});

// ---------------------------------------------------------------------------
// P3 / P4 — the NON-REGRESSION axis, from the plausible WRONG FIX
// ---------------------------------------------------------------------------

describe('objectui#8060 · P3 the designer still owns every type inside its own set', () => {
  it('offers all 27 as editable, carries none of them through, and round-trips each', async () => {
    const stored: Record<string, Record<string, unknown>> = {};
    for (const t of DESIGNER_TYPES) {
      stored[`f_${t}`] = t === 'lookup'
        ? { type: t, label: t, reference: 'invoice' }
        : CHOICE_TYPES_REQUIRING_OPTIONS.includes(t)
          ? { type: t, label: t, options: [OPEN_OPTION] }
          : { type: t, label: t };
    }

    await renderPage(stored);

    // ⚠️ The plausible WRONG FIX preserves so broadly that a field the designer
    // legitimately owns becomes read-only. Nothing here may be carried through.
    expect(screen.queryByTestId('metadata-fields-page-preserved')).toBeNull();

    let offered = 0;
    for (const t of DESIGNER_TYPES) {
      const field = designerProps!.fields.find((f) => f.name === `f_${t}`);
      expect(field, `${t} must be offered to the designer`).toBeDefined();
      expect(field!.type, `${t} must be read back as itself`).toBe(t);
      offered += 1;
    }
    expect(offered).toBe(27);
    expect(offered).toBe(DESIGNER_TYPES.length);

    const wire = await relabelControlOnly();
    let written = 0;
    for (const t of DESIGNER_TYPES) {
      expect(wire[`f_${t}`].type, `${t} must round-trip on the wire`).toBe(t);
      written += 1;
    }
    expect(written).toBe(27);
  });
});

describe('objectui#8060 · P4 a designer-owned type CHANGE is still honored', () => {
  it('writes the new type the author chose, not the stored one', async () => {
    await renderPage({ stage: { type: 'select', label: 'Stage' } });

    const next = designerProps!.fields.map((f) =>
      f.name === 'stage' ? { ...f, type: 'number' as const } : f,
    );
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    // A "preserve everything" fix writes `select` here and this goes RED — the
    // caricature in the OTHER direction from the bug.
    expect(puts[0].body.fields.stage.type).toBe('number');
    expect(puts[0].body.fields.stage.type).not.toBe('select');
  });
});

// ---------------------------------------------------------------------------
// P5 — a stored type in NEITHER vocabulary
// ---------------------------------------------------------------------------

describe('objectui#8060 · P5 a stored type in neither set', () => {
  it('is carried through verbatim, so the server refuses it LOUDLY instead of it being erased', async () => {
    // Not a spec `FieldType` and not a designer type. Preserving it means the
    // PUT comes back 422 naming this field — the author is told and the stored
    // document is untouched. Rewriting it to `text` would make the save SUCCEED
    // and destroy the evidence, which is this card's whole shape.
    expect(SPEC_FIELD_TYPES).not.toContain('quantum_flux');
    expect(DESIGNER_TYPES).not.toContain('quantum_flux');

    await renderPage({ odd: { type: 'quantum_flux', label: 'Odd' } });

    expect(screen.getByTestId('metadata-fields-page-preserved-type-odd').textContent)
      .toBe('quantum_flux');

    const wire = await relabelControlOnly();
    expect(wire.odd.type).toBe('quantum_flux');
    expect(wire.odd.type).not.toBe('text');
  });

  it('leaves a field with NO stored type to the designer — there is nothing stored to destroy', async () => {
    await renderPage({ typeless: { label: 'Typeless' } });

    // Deliberately the OTHER side of the rule: the defect was rewriting a type
    // the document HELD. An absent type is not one, so `'text'` here invents a
    // value rather than replacing one, and the field stays editable.
    expect(screen.queryByTestId('metadata-fields-page-preserved')).toBeNull();
    expect(designerProps!.fields.find((f) => f.name === 'typeless')!.type).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// P6 — ordering, and the collision the read-only half makes reachable
// ---------------------------------------------------------------------------

describe('objectui#8060 · P6 the carried-through half keeps its place in the document', () => {
  it('writes the fields back in stored declaration order, preserved ones in situ', async () => {
    await renderPage({
      vec: { type: 'vector', label: 'Vec' },
      stage: { type: 'select', label: 'Stage', options: [OPEN_OPTION] },
    });

    const wire = await relabelControlOnly();
    // The spec has no field-level ordering key, so DECLARATION ORDER in the
    // `fields` record IS the object's field order — a preserved field that
    // jumped to the end would silently reorder the author's object.
    expect(Object.keys(wire)).toEqual(['name', 'vec', 'stage']);
  });

  it('keeps stored fields ahead of a newly added one, carried-through ones included', async () => {
    await renderPage({
      vec: { type: 'vector', label: 'Vec' },
      stage: { type: 'select', label: 'Stage', options: [OPEN_OPTION] },
    });

    const next: DesignerFieldDefinition[] = [
      ...designerProps!.fields,
      { id: 'fld_new', name: 'brand_new', label: 'Brand new', type: 'text' },
    ];
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    // `vec` is not in the designer's list at all, so it has no anchor of its
    // own to sort against the new field — it must still land in its stored slot
    // rather than being pushed behind a field the author only just created.
    expect(Object.keys(puts[0].body.fields)).toEqual(['name', 'vec', 'stage', 'brand_new']);
    expect(puts[0].body.fields.vec.type).toBe('vector');
  });

  it('refuses a new field whose name collides with a carried-through one, and issues no PUT', async () => {
    await renderPage({ vec: { type: 'vector', label: 'Vec' } });

    const next: DesignerFieldDefinition[] = [
      ...designerProps!.fields,
      { id: 'fld_new', name: 'vec', label: 'My new field', type: 'text' },
    ];
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });

    await waitFor(() =>
      expect(screen.getByTestId('metadata-fields-page-error').textContent)
        .toMatch(/collides with a stored field of type `vector`/),
    );
    expect(puts).toEqual([]);
  });
});
