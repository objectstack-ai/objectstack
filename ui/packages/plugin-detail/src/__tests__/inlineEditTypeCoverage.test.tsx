/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Drift guard — every field type has an explicit inline-edit decision on the
 * DETAIL page (objectui#4220).
 *
 * ## Why this file exists
 *
 * `InlineFieldInput` hand-rolls a type switch that ends in a raw text input,
 * and `@object-ui/fields` maintains the form's widget map. The two lists drifted
 * apart repeatedly, and every time they did, the gap was silent AND lossy: a
 * type nobody had thought about fell to the terminal input, was displayed
 * through `coerceToSafeValue` and written back as a bare string. That produced
 * six cards from ONE cause — #2942 (the grid's copy), #3355, #4216, #4219,
 * #4221/#4228 and this one — so the deliverable that outlives the fix is not
 * another routing line, it is this assertion.
 *
 * The fields package already guards ITS half (`FieldEditWidget.test.ts`: every
 * form type is a widget or a documented exclusion). This is the detail page's
 * matching pair, over the SAME universe of types plus the spec's own enum.
 *
 * ## The contract
 *
 * Every field type must fall into EXACTLY ONE of four buckets:
 *
 * | bucket | who decides | what the user gets |
 * |---|---|---|
 * | **excluded** | the hosts' gates (`isInlineExcludedDetailFieldType` / `isComputedFieldType`) | no inline editor at all — containers, credentials, computed |
 * | **routed** | `InlineFieldInput`'s own switch (`INLINE_ROUTED_FIELD_TYPES`) | the dedicated editor that type already had |
 * | **delegated** | `FieldEditWidget` | the SAME widget the form uses |
 * | **benign** | `INLINE_PLAIN_TEXT_FIELD_TYPES` | the terminal text input, losslessly (the value is already a single-line string) |
 *
 * A type in NONE of the four is red — that is a new type nobody decided about,
 * and the default it would otherwise inherit is the value-destroying one. A
 * type in TWO is red as well: overlapping claims are how a decision gets made
 * twice and disagrees with itself.
 *
 * The two behavioural halves below are what stop this from being a tautology
 * over four hand-written sets: the declared bucket is checked against what
 * `InlineFieldInput` actually RENDERS for that type.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';
import {
  FORM_FIELD_TYPES,
  hasFieldEditWidget,
  isInlineExcludedFieldType,
} from '@object-ui/fields';
import {
  InlineFieldInput,
  INLINE_PLAIN_TEXT_FIELD_TYPES,
  INLINE_PLAIN_TEXT_INPUT_TESTID,
  INLINE_ROUTED_FIELD_TYPES,
  isKnownFieldType,
} from '../InlineFieldInput';
import { isComputedFieldType, isInlineExcludedDetailFieldType } from '../fieldEnrichment';

/**
 * The universe: the form's widget-map keys UNION the spec's `FieldType` enum.
 *
 * Neither alone is enough. `FORM_FIELD_TYPES` misses every spec spelling that
 * reaches a widget through the alias table — `toggle`, `progress`, `json`,
 * `composite`, `autonumber`, `secret`, `video` — which is precisely the set
 * that fell through the switch in #2942 and again here. The spec enum misses
 * the form-only keys (`object`, `grid`, `geolocation`, the widget-hint
 * pickers).
 *
 * `owner` was named here as a form-only key until objectui#4814 retired the
 * spelling. It is now in NEITHER set — gone from `FORM_FIELD_TYPES`, and never
 * a member of the spec enum, which is the card's own premise — so it leaves
 * this universe entirely rather than moving between buckets.
 */
const specTypes: string[] = enumOptions(FieldType);
const ALL_TYPES = [...new Set([...FORM_FIELD_TYPES, ...specTypes])].sort();

/** The hosts never even render an editor for these (the gates, not this switch). */
const isGatedByHost = (type: string): boolean =>
  isInlineExcludedDetailFieldType(undefined, type) || isComputedFieldType(undefined, type);

function bucketsOf(type: string): string[] {
  const buckets: string[] = [];
  if (isGatedByHost(type)) buckets.push('excluded');
  if (INLINE_ROUTED_FIELD_TYPES.has(type)) buckets.push('routed');
  if (INLINE_PLAIN_TEXT_FIELD_TYPES.has(type)) buckets.push('benign');
  // Delegation is what the runtime does with everything left over — the same
  // two conditions `InlineFieldInput` applies, read from the same exports.
  if (
    buckets.length === 0 &&
    isKnownFieldType(type) &&
    hasFieldEditWidget(type)
  ) {
    buckets.push('delegated');
  }
  return buckets;
}

/**
 * Metadata that makes each type's editor renderable in its CANONICAL shape.
 * A picklist without options and a lookup without a `reference` are
 * degenerate configurations, not the type's normal form; both degenerate
 * picklist spellings are pinned by name in the sibling delegation suite.
 */
const FIELD_FIXTURE: Record<string, Record<string, unknown>> = {
  select: { options: [{ label: 'A', value: 'a' }] },
  multiselect: { options: [{ label: 'A', value: 'a' }] },
  radio: { options: [{ label: 'A', value: 'a' }] },
  checkboxes: { options: [{ label: 'A', value: 'a' }] },
  lookup: { reference: 'crm_account' },
  master_detail: { reference: 'crm_account' },
  tree: { reference: 'crm_account' },
};

/** A value of the type's real SHAPE — the point is what the editor does with it. */
const VALUE_FIXTURE: Record<string, unknown> = {
  tags: ['a', 'b'],
  checkboxes: ['a'],
  multiselect: ['a'],
  vector: [1, 2, 3],
  boolean: true,
  toggle: true,
  number: 1,
  currency: 1,
  percent: 1,
  slider: 40,
  progress: 40,
  rating: 3,
  date: '2026-08-11',
  datetime: '2026-08-11T00:00:00.000Z',
  time: '09:30',
  color: '#ff0000',
  address: { street: '1 Main St' },
  location: { latitude: 1, longitude: 2 },
  geolocation: { latitude: 1, longitude: 2 },
  object: { a: 1 },
  composite: { a: 1 },
  record: { a: 1 },
  grid: [{ a: 1 }],
  repeater: [{ a: 1 }],
  json: '{"a":1}',
  image: null,
  avatar: null,
  file: null,
  video: null,
  audio: null,
  signature: '',
  'filter-condition': [],
};
const valueFor = (type: string) => (type in VALUE_FIXTURE ? VALUE_FIXTURE[type] : 'v-1');

const renderInline = (type: string) =>
  render(
    <InlineFieldInput
      field={{ name: 'f', type, ...(FIELD_FIXTURE[type] ?? {}) }}
      value={valueFor(type)}
      onChange={vi.fn()}
      dataSource={{ find: vi.fn(async () => ({ data: [], total: 0 })) }}
    />,
  );

/** Did this type land on the terminal raw text input? */
const reachedPlainInput = () =>
  screen.queryAllByTestId(INLINE_PLAIN_TEXT_INPUT_TESTID).length > 0;

// ---------------------------------------------------------------------------
// The partition
// ---------------------------------------------------------------------------

describe('inline-edit type coverage — every type has exactly one decision (#4220)', () => {
  it('reads a non-empty enum from the spec', () => {
    expect(specTypes, 'could not read FieldType.options from the spec').not.toEqual([]);
  });

  it('the universe is the union of the form widget map and the spec enum', () => {
    // Sanity on the guard itself: if either source stopped contributing, the
    // partition below would still pass while covering half the types.
    expect(ALL_TYPES.length).toBeGreaterThan(FORM_FIELD_TYPES.length);
    expect(ALL_TYPES.length).toBeGreaterThan(specTypes.length);
  });

  it('no type is left undecided', () => {
    const undecided = ALL_TYPES.filter((t) => bucketsOf(t).length === 0);
    // If this fails: a field type would fall to the terminal raw text input by
    // ACCIDENT — displayed through `coerceToSafeValue` and saved as a string.
    // Decide it: give it a branch (INLINE_ROUTED_FIELD_TYPES), let it delegate
    // (a widget in the fields package's EDIT_WIDGETS), gate it out (the shared
    // INLINE_EXCLUDED_FIELD_TYPES), or declare it benign
    // (INLINE_PLAIN_TEXT_FIELD_TYPES — only if its stored value is a string
    // that cannot span lines: the terminal input is one line, objectui#11562).
    expect(undecided).toEqual([]);
  });

  it('no type is claimed twice', () => {
    const overlapping = ALL_TYPES.map((t) => [t, bucketsOf(t)] as const).filter(
      ([, b]) => b.length > 1,
    );
    expect(overlapping).toEqual([]);
  });

  it('the benign list is explicit, and every member really is string-valued', () => {
    // Enumerated, never "everything else" — an open tail is the drift itself.
    // `textarea` left this list in objectui#11562: its value is a string, but
    // a MULTI-line one, and the terminal input is one line, so a stored value
    // with line breaks was saved flattened. It is routed now (see below).
    expect([...INLINE_PLAIN_TEXT_FIELD_TYPES].sort()).toEqual([
      'email',
      'phone',
      'text',
      'url',
    ]);
  });

  it('the four buckets, as landed (documentation the next reader can diff)', () => {
    const byBucket: Record<string, string[]> = {};
    for (const t of ALL_TYPES) {
      const [bucket] = bucketsOf(t);
      (byBucket[bucket] ||= []).push(t);
    }
    expect(byBucket).toEqual({
      excluded: [
        'auto_number', 'autonumber', 'composite', 'filter-condition', 'formula',
        'grid', 'html', 'object', 'object-ref', 'password',
        // objectui#7611: the registry-name pickers, widget hints like
        // `object-ref`.
        'permission-ref', 'position-ref',
        'recipient-picker', 'record', 'repeater', 'richtext', 'secret',
        'summary', 'vector',
      ],
      // `owner` stood between `number` and `percent` until objectui#4814
      // retired the spelling. It is NOT re-bucketed here: it left `ALL_TYPES`
      // altogether (see the universe note above), so there is no decision left
      // to document. The retirement itself is pinned in one place —
      // `packages/fields/src/__tests__/owner-retired.test.tsx`.
      //
      // This snapshot is derived from `ALL_TYPES`, not from
      // `INLINE_ROUTED_FIELD_TYPES`, so it could not see that the set itself
      // still listed `'owner'` — a member consulted at runtime against a
      // STORED field's type, which is why it was a live inconsistency rather
      // than dead code. objectui#4914 removed it and gave inline edit the same
      // loud refusal the form gives; that disposition is pinned by
      // `InlineFieldInput.retiredFieldType.test.tsx`, which also asserts no
      // retired spelling can re-enter this set.
      // `markdown` sat in `excluded` until objectui#11541: the detail row now
      // routes it to the multi-line `TextAreaField`, and the grid cell keeps
      // the shared exclusion. `html` / `richtext` stay excluded, unchanged.
      // `textarea` sat in `benign` until objectui#11562 and is routed to the
      // same `TextAreaField`; the grid cell already edited it with that widget.
      // `date` / `datetime` sat in `routed` (the native date input) until
      // objectui#12759: they delegate to the platform date picker the grid
      // cell draws, so a `datetime` edits its time too.
      routed: [
        'address', 'audio', 'avatar', 'boolean', 'currency',
        'file', 'geolocation', 'image', 'location', 'lookup', 'markdown',
        'master_detail', 'multiselect', 'number', 'percent', 'select',
        'signature', 'textarea', 'tree', 'user', 'video',
      ],
      delegated: ['checkboxes', 'code', 'color', 'date', 'datetime', 'json', 'progress', 'qrcode', 'radio', 'rating', 'slider', 'tags', 'time', 'toggle'],
      benign: ['email', 'phone', 'text', 'url'],
    });
  });
});

// ---------------------------------------------------------------------------
// The declared buckets, checked against what actually renders
// ---------------------------------------------------------------------------

describe('the declared bucket matches what InlineFieldInput renders', () => {
  for (const type of ALL_TYPES) {
    const [bucket] = bucketsOf(type);

    if (bucket === 'excluded') {
      it(`\`${type}\` (excluded) is gated before an editor is ever rendered`, () => {
        // The hosts own this one; nothing is asserted about the switch, which
        // is never reached. Both gates are alias-aware and narrow-only.
        expect(isGatedByHost(type)).toBe(true);
      });
      continue;
    }

    if (bucket === 'benign') {
      it(`\`${type}\` (benign) really does render the terminal text input`, () => {
        renderInline(type);
        expect(reachedPlainInput()).toBe(true);
      });
      continue;
    }

    it(`\`${type}\` (${bucket}) renders a real editor, never the terminal text input`, () => {
      renderInline(type);
      // This is what makes `INLINE_ROUTED_FIELD_TYPES` honest: a member whose
      // branch was deleted stops rendering its own editor, and a delegated type
      // whose widget disappeared falls back here — both surface as a plain
      // input where the table promised an editor.
      expect(reachedPlainInput()).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// The exclusion half stays anchored to the SHARED set (no second list)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// #4219 ride-along — the spec `autonumber` spelling, re-measured after #4228
// ---------------------------------------------------------------------------

/**
 * #4219 reported that `TEXTUAL_REF_FALLBACK_TYPES` — the COMPUTED gate — spells
 * the type `auto_number` only, while `@objectstack/spec` (and the designer, and
 * the importer) spell it `autonumber`, so a machine-generated identity was
 * hand-editable on the detail page.
 *
 * #4228 changed the reachability underneath that report: both hosts now also
 * consult the fields package's shared exclusion, which is alias-aware —
 * `autonumber` resolves through `mapFieldTypeToFormType` onto the excluded
 * `auto_number`. The affordance is therefore already gone, by a different gate
 * than the one #4219 names. These pin that, so the card can be closed on
 * measurement rather than on reasoning.
 *
 * The computed gate's own spelling gap is NOT pinned here in either direction:
 * it is #4219's to decide, and a pin asserting today's asymmetry would go red
 * on the very fix that card proposes.
 */
describe('#4219 — an `autonumber` field offers no inline editor after #4228', () => {
  beforeAll(() => {
    // Desktop layout — the mobile branch renders its own read-only row shape.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  const hasPencil = () => screen.queryAllByLabelText('Double-click to edit').length > 0;
  const schema = { fields: { invoice_no: { type: 'autonumber' } } };
  const data = { invoice_no: 'INV-000317' };

  function EnterEdit({ name }: { name: string }) {
    const inline = useInlineEdit();
    return <button type="button" onClick={() => inline!.enter(name)}>enter-edit</button>;
  }

  it('the details body renders no affordance, and no editor even in edit mode', () => {
    const { container } = render(
      <DetailSection
        section={{ fields: [{ name: 'invoice_no', label: 'Invoice #' }] } as unknown as DetailViewSection}
        data={data}
        objectSchema={schema}
        isEditing
        onEnterInlineEdit={vi.fn()}
      />,
    );
    expect(hasPencil()).toBe(false);
    expect(container.querySelector('input')).toBeNull();
    expect(screen.queryByDisplayValue('INV-000317')).toBeNull();
  });

  it('the highlights strip renders no affordance, and no editor inside the session', () => {
    const { container } = render(
      <InlineEditProvider canEdit>
        <HeaderHighlight
          fields={[{ name: 'invoice_no', label: 'Invoice #' }] as any}
          data={data}
          objectSchema={schema}
        />
        <EnterEdit name="invoice_no" />
      </InlineEditProvider>,
    );
    expect(hasPencil()).toBe(false);
    fireEvent.click(screen.getByText('enter-edit'));
    expect(container.querySelector('input')).toBeNull();
    expect(screen.queryByDisplayValue('INV-000317')).toBeNull();
  });

  it('the gate that catches it is the shared exclusion (alias-resolved)', () => {
    expect(isInlineExcludedDetailFieldType(undefined, 'autonumber')).toBe(true);
    expect(isInlineExcludedDetailFieldType('autonumber', undefined)).toBe(true);
  });
});

describe('the excluded bucket is the fields package’s set, not a local copy', () => {
  it('every excluded type is either in the shared set or machine-computed', () => {
    const excluded = ALL_TYPES.filter((t) => bucketsOf(t)[0] === 'excluded');
    const strays = excluded.filter(
      (t) => !isInlineExcludedFieldType(t) && !isComputedFieldType(undefined, t),
    );
    // A local exclusion with no upstream reason is exactly the second
    // hand-maintained list this whole family of bugs came from.
    expect(strays).toEqual([]);
  });
});
