/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9056 — the protocol's body width is a STRING, and every slot it
 * reaches inside this package is a NUMBER.
 *
 * `@objectstack/spec`'s `RecordDetailsProps.columns` is `z.enum(['1','2','3','4'])`.
 * `RecordDetailsRenderer` used to hand that value straight into the detail node
 * it synthesizes, and from there it reached — every one of these declared
 * `number` in `@object-ui/types` or in this package:
 *
 *   `DetailViewSchema.columns` -> `DetailViewSection.columns`
 *     -> `applyDetailAutoLayout(fields, columns)` -> `applyAutoSpan(fields, columns)`
 *     -> `DetailViewField.span`
 *
 * Measured on the real render before the fix: `applyDetailAutoLayout` received
 * `typeof 'string'`, and a wide field's `span` came out the string `'2'`.
 * `tsc` could not see any of it, because the object the renderer builds is
 * annotated `any` and that annotation launders the assignment (the identical
 * write into a `DetailViewSchema` is `TS2322`, both from this renderer's own
 * prop type and from a bare `RecordDetailsComponentProps`).
 *
 * ## ⚠️ WHY NOT ONE DOM ASSERTION IN THE VALUE LEGS
 *
 * The single consumer of `span` is `getResponsiveSpanClass`, and over the whole
 * reachable set it emits BYTE-IDENTICAL classes for `'2'` and `2` — `span` is
 * always the same value the width came from, so the strict-equality rungs that
 * would have diverged (`span === 3` against a width of 4) are unreachable. A
 * pin that asserted rendered output therefore COULD NOT GO RED on this change,
 * and a green suite full of such rows is indistinguishable from no verification
 * at all. Every leg below that pins the FIX reads the value itself — `typeof`
 * and strict equality on what actually lands — captured from the real
 * `applyDetailAutoLayout` / `applyAutoSpan` path driven by a real render.
 *
 * The one DOM leg here is labelled for what it is: the COMPATIBILITY claim
 * ("no rendered class moves"), which needs its own instrument precisely because
 * the value legs cannot speak to it. It carries a lit control so it is not a
 * silent tautology.
 *
 * ## ⚠️ WHICH HALF OF THE FIXTURE IS HOST-COMPOSED, AND WHY
 *
 * A spec-validated `record:details` document declares `fields` as `string[]`
 * (measured against the installed spec below, in both directions), so an
 * authored entry cannot carry the `type` that `applyAutoSpan` tests for. The
 * `span` legs therefore drive the OBJECT entry form — which this renderer
 * documents and admits (`normaliseField` passes object entries through, and
 * `RecordDetailsRendererProps.schema` is the props bag intersected with
 * `Record<string, any>` for exactly that reason). The `columns` value on every
 * fixture is the contract's own spelling and is parsed green here to prove it.
 * ⛔ Do not read the `span` legs as "the flat body of a spec-only document
 * produces spans" — it does not, and the leg that runs on a purely spec-valid
 * document (THE CONTRACT LEG) is the one that pins the boundary without it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { RecordDetailsProps } from '@objectstack/spec/ui';
import { RecordContextProvider } from '@object-ui/react';
import type { DetailViewField } from '@object-ui/types';

/**
 * Every `applyDetailAutoLayout` call the render below made — the argument that
 * crossed the boundary and the fields that came back out of it.
 *
 * `vi.hoisted` because the factory runs before this module's own bindings are
 * initialized.
 */
const recorder = vi.hoisted(() => ({
  calls: [] as Array<{ columns: unknown; outColumns: unknown; fields: DetailViewField[] }>,
}));

vi.mock('../../autoLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../autoLayout')>();
  return {
    ...actual,
    // Same signature, same return value — the real function does the work and
    // this wrapper only reads what passed through it. Nothing here decides an
    // outcome, so a drifting stub cannot make a leg pass.
    applyDetailAutoLayout: ((
      fields: Parameters<typeof actual.applyDetailAutoLayout>[0],
      columns: Parameters<typeof actual.applyDetailAutoLayout>[1],
      containerWidth?: Parameters<typeof actual.applyDetailAutoLayout>[2],
    ) => {
      const out = actual.applyDetailAutoLayout(fields, columns, containerWidth);
      recorder.calls.push({ columns, outColumns: out.columns, fields: out.fields });
      return out;
    }) as typeof actual.applyDetailAutoLayout,
  };
});

import { RecordDetailsRenderer } from '../record-details';

const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    notes: { type: 'textarea', label: 'Notes' },
    industry: { type: 'text', label: 'Industry' },
    phone: { type: 'text', label: 'Phone' },
    email: { type: 'text', label: 'Email' },
  },
};

/** No name-ish VALUE, so the title-dedupe ladder hides no row it is asked about. */
const data = { notes: 'A long note', industry: 'Manufacturing', phone: '555-0100', email: 'ops@acme.test' };

/**
 * The OBJECT entry form (see the header): `type` is what `applyAutoSpan` tests,
 * and a bare-string entry cannot carry one.
 */
const TYPED_FIELDS = [
  { name: 'notes', type: 'textarea' },
  { name: 'industry' },
  { name: 'phone' },
  { name: 'email' },
];

/** The bare-string form a spec-validated document is limited to. */
const BARE_FIELDS = ['notes', 'industry', 'phone', 'email'];

beforeEach(() => {
  recorder.calls.length = 0;
  // The permission provider's `security/explain` probe would otherwise reach a
  // real socket and trip the suite's network-escape guard.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderDoc = (schema: Record<string, unknown>) =>
  render(
    <RecordContextProvider
      objectName="crm_account"
      recordId="A1"
      data={data}
      objectSchema={objectSchema}
    >
      <RecordDetailsRenderer schema={schema as never} />
    </RecordContextProvider>,
  );

/** The one layout call the flat body makes, with a guard against reading a zero. */
const soleCall = () => {
  expect(recorder.calls.length, 'the render drove the real auto-layout path at least once').toBeGreaterThan(0);
  return recorder.calls[0];
};

const fieldNamed = (fields: DetailViewField[], name: string) => {
  const f = fields.find((x) => x.name === name);
  expect(f, `the layout output still carries \`${name}\``).toBeDefined();
  return f!;
};

describe('objectui#9056 — the protocol string is coerced at the boundary, not carried into `number` slots', () => {
  it('THE CONTRACT LEG — a document the installed spec accepts hands the layout a NUMBER', () => {
    const doc = { columns: '3', fields: BARE_FIELDS };

    // The fixture IS the contract's spelling, on the installed artifact...
    expect(RecordDetailsProps.safeParse(doc).success, 'the fixture is a spec-valid document').toBe(true);
    // ...and the control that would have fired: the number is what the contract
    // refuses at the top level, which is the whole reason this string exists.
    expect(
      RecordDetailsProps.safeParse({ ...doc, columns: 3 }).success,
      'the control: the top-level key refuses the number, so the string is not a local invention',
    ).toBe(false);

    renderDoc(doc);

    const call = soleCall();
    expect(typeof call.columns, 'the value that crossed into `applyDetailAutoLayout`').toBe('number');
    expect(call.columns).toBe(3);
    // And what it returns into `DetailViewSection.columns` / `rawColumns`, which
    // is declared `number` one frame further out.
    expect(typeof call.outColumns).toBe('number');
    expect(call.outColumns).toBe(3);
  });

  it('THE SPAN LEG — a wide field receives a NUMBER span, with both live controls in the same render', () => {
    renderDoc({
      columns: '2',
      fields: [
        ...TYPED_FIELDS,
        // LIVE CONTROL B, authored into the same document: an explicit span.
        { name: 'name', type: 'textarea', span: 1 },
      ],
    });

    const { fields } = soleCall();

    // THE REPAIR: the slot `@object-ui/types` declares `number` holds a number.
    const wide = fieldNamed(fields, 'notes');
    expect(typeof wide.span, '`DetailViewField.span` on a wide field').toBe('number');
    expect(wide.span).toBe(2);

    // LIVE CONTROL A — a non-wide field still gets no span at all. Without it,
    // "span is a number" is equally satisfied by an `applyAutoSpan` that stopped
    // writing spans, and a reviewer could not tell the repair from a rout.
    expect(fieldNamed(fields, 'industry').span, 'a non-wide field is still untouched').toBeUndefined();
    expect(fieldNamed(fields, 'phone').span).toBeUndefined();

    // LIVE CONTROL B — an explicitly authored span still wins and is returned
    // byte-for-byte, never overwritten by the coerced width.
    const authored = fieldNamed(fields, 'name');
    expect(authored.span, 'an authored span still takes priority').toBe(1);
    expect(typeof authored.span).toBe('number');
  });

  it('THE EARLY-RETURN LEG — `columns: \'1\'` reaches the guard as the NUMBER 1 and still spans nothing', () => {
    // Before the fix this branch was accidentally correct: `'1' <= 1` is also
    // `true`. The assertion is therefore on the VALUE the guard compares, not on
    // the outcome — the outcome never moved and cannot witness the change.
    expect(RecordDetailsProps.safeParse({ columns: '1' }).success, 'the narrow width is in the contract\'s closed set').toBe(true);

    renderDoc({ columns: '1', fields: TYPED_FIELDS });

    const call = soleCall();
    expect(typeof call.columns).toBe('number');
    expect(call.columns).toBe(1);
    // The behaviour half, unchanged in both directions.
    for (const f of call.fields) {
      expect(f.span, `\`${f.name}\` gets no span at a single-column width`).toBeUndefined();
    }
  });

  it('THE UNAUTHORED LEG — an omitted width stays `undefined`, so inference still runs', () => {
    // The load-bearing arm of the coercion. `Number(undefined)` is `NaN`, which
    // is NOT `undefined`, so a bare `Number(...)` at the boundary would replace
    // every unauthored body's inferred width with `NaN` — silently, and with no
    // rendered class to notice it by.
    renderDoc({ fields: TYPED_FIELDS });

    const call = soleCall();
    expect(call.columns, 'nothing was authored, so nothing is handed down').toBeUndefined();
    expect(typeof call.outColumns, 'and the inference produced a real width').toBe('number');
    expect(Number.isNaN(call.outColumns as number)).toBe(false);
    expect(call.outColumns).toBe(2);
  });

  it('THE OTHER CALL SITE — `sections[].columns` is a NUMBER on the contract and passes through untouched', () => {
    const doc = { columns: '4', sections: [{ label: 'Contact', columns: 2, fields: BARE_FIELDS }] };

    // The inversion objectui#8604 pinned, restated here because this fix must
    // not "unify" the two: a section takes the number and refuses the string.
    expect(RecordDetailsProps.safeParse(doc).success).toBe(true);
    expect(
      RecordDetailsProps.safeParse({ sections: [{ fields: BARE_FIELDS, columns: '2' }] }).success,
      'the control: one level down, the string is the refused spelling',
    ).toBe(false);

    renderDoc(doc);

    const call = soleCall();
    expect(typeof call.columns, 'a section width never passes through the body boundary').toBe('number');
    expect(call.columns).toBe(2);
  });

  it('THE COMPATIBILITY LEG — no rendered class moves (⛔ this leg cannot witness the fix)', () => {
    // ⛔ NOT evidence of the repair, and must never be cited as such: the string
    // and the number emit byte-identical classes, so this comparison is green in
    // both trees. It exists to guard the CLAIM the fix makes — that the DOM does
    // not move — and it goes red the day a coercion changes a width.
    const fields = TYPED_FIELDS;
    const asProtocolString = renderDoc({ columns: '2', fields }).container.innerHTML;
    cleanup();
    const asNumber = renderDoc({ columns: 2, fields }).container.innerHTML;
    cleanup();
    expect(asProtocolString, 'the protocol string and the number render the same body').toBe(asNumber);

    // THE LIT CONTROL, same instrument, same run: this comparison DOES see a
    // difference, so the equality above is a measurement and not a tautology
    // about an instrument that reads nothing.
    const atFour = renderDoc({ columns: '4', fields }).container.innerHTML;
    cleanup();
    expect(atFour, 'the control: a different authored width really does move the DOM').not.toBe(asProtocolString);
    expect(asProtocolString).toContain('md:col-span-2');
    expect(atFour).toContain('xl:col-span-4');
  });
});
