/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5625 — `ObjectPivotTable` reads `fieldLabel` / `fieldOptionLabel`
 * DIRECTLY, derives its label maps exactly once, and re-derives when the
 * resolver genuinely changes.
 *
 * The metadata-derivation effect used to hide both resolvers behind refs,
 * because `useSafeFieldLabel()` handed back a fresh object on every render
 * outside an i18next provider (objectui#5564). A direct dependency would then
 * have re-run the effect on every render — and this effect ends in
 * `setFieldLabelMaps` / `setFieldNameLabels` with freshly built objects, so
 * every run scheduled the next one: an unbounded derive loop. That is what the
 * refs were written to stop, and it is the same shape objectui#5587 removed
 * from `ObjectChart` (PR #5628), one package over.
 *
 * `useObjectLabel`'s memo now holds on BOTH paths, so the refs are dead weight
 * and the dependencies can be honest.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS NOT AN OUTPUT TEST
 * -------------------------------------------------------
 * Nothing *renders* wrong under the loop — the pivot just re-derives forever
 * and the labels it shows are correct each time round. So a test that mounts
 * once and checks the headers is green against the defect. These cases assert
 * instead:
 *
 *   1. a DERIVATION COUNT across forced re-renders (`getObjectSchema` calls —
 *      the effect's one observable side effect), both OUTSIDE and INSIDE a
 *      provider, since those are the two identity paths the refs straddled; and
 *   2. that the two derived state maps SETTLE — one distinct `rowLabels`
 *      identity (`fieldLabelMaps`), one distinct `rowFieldLabel`
 *      (`fieldNameLabels`), and a render count that stops growing over a quiet
 *      window with no further work scheduled.
 *
 * The third case covers the half that the removal actually BUYS: a ref-hidden
 * dependency meant the effect did NOT re-run when the resolver changed, so a
 * pivot rendered across a language switch kept serving header and option
 * labels resolved by the old resolver until some unrelated dependency happened
 * to move.
 *
 * NOTE ON ORDER: `createI18n` registers its instance as react-i18next's
 * process-global, and `useTranslation` falls back to that global when no
 * context supplies one — a registration that survives unmount and `cleanup()`.
 * The no-provider case therefore runs FIRST, and asserts the RAW labels rather
 * than localized ones: if an instance ever leaked into it, that assertion fails
 * instead of the case quietly becoming a second test of the with-provider path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, act, waitFor } from '@testing-library/react';

const captured = vi.hoisted(() => ({
  renders: [] as Array<{ rowLabels: any; rowFieldLabel: any }>,
}));

vi.mock('../PivotTable', () => ({
  PivotTable: ({ rowLabels, rowFieldLabel }: any) => {
    captured.renders.push({ rowLabels, rowFieldLabel });
    return null;
  },
}));

import { I18nProvider, createI18n } from '@object-ui/i18n';
import { ObjectPivotTable } from '../ObjectPivotTable';

afterEach(() => {
  cleanup();
  captured.renders.length = 0;
});

/**
 * Module-level so the fetch effect's `schema.data` / `schema.filter`
 * dependencies hold still — this file is measuring ONE effect, and a fresh
 * schema object per render would move the other one underneath it.
 *
 * `data` carries rows, which is what keeps the fetch effect out of the way
 * entirely (its guard is `!schema.data || schema.data.length === 0`). The data
 * source below therefore offers only `getObjectSchema`, making that mock an
 * unambiguous counter for the derivation effect under test.
 */
const SCHEMA = {
  type: 'pivot-table',
  objectName: 'deal',
  rowField: 'stage',
  columnField: 'owner',
  valueField: 'amount',
  data: [{ stage: 'won', owner: 'amy', amount: 10 }],
} as any;

/**
 * `stage` is a `select` with options, so it lands in BOTH derived maps —
 * `fieldLabelMaps.stage` (value→label) and `fieldNameLabels.stage` (the header
 * label). One field exercising both is what lets a single pair of assertions
 * speak for both state maps.
 */
const OBJECT_SCHEMA = {
  fields: {
    stage: { type: 'select', label: 'Stage', options: [{ value: 'won', label: 'Won' }] },
    owner: { type: 'text', label: 'Owner' },
  },
};

const RAW_FIELD_LABEL = 'Stage';
const RAW_OPTION_LABEL = 'Won';

const makeSource = () => ({ getObjectSchema: vi.fn(async () => OBJECT_SCHEMA) });

/**
 * Let anything the render just scheduled actually run.
 *
 * Deliberately a plain timer rather than an exhaustive `act` drain: a derive
 * loop regenerates work as fast as act drains it, so draining would HANG
 * instead of failing. A fixed window lets the counts be READ — under the loop
 * they climb into the dozens, and the assertion reports the number.
 */
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

const lastRender = () => captured.renders[captured.renders.length - 1];

/** Mount under a host that can force re-renders of the same element tree. */
function mountWithChurn(wrap: (el: React.ReactElement) => React.ReactElement) {
  const src = makeSource();
  let bump: (() => void) | null = null;
  const Host = () => {
    const [, setTick] = React.useState(0);
    bump = () => setTick((n) => n + 1);
    return <ObjectPivotTable schema={SCHEMA} dataSource={src} />;
  };
  render(wrap(<Host />));
  return {
    src,
    churn: (times: number) => {
      for (let i = 0; i < times; i += 1) act(() => { bump!(); });
    },
  };
}

/** Distinct identities/values actually handed to `PivotTable`, ignoring pre-derivation undefined. */
const distinct = (pick: (r: { rowLabels: any; rowFieldLabel: any }) => any) =>
  new Set(captured.renders.map(pick).filter((v) => v !== undefined));

/**
 * Mount, wait for the first derivation, force three more renders, then report
 * the derivation count and whether the derived state settled.
 */
async function deriveAcrossRerenders(wrap: (el: React.ReactElement) => React.ReactElement) {
  const { src, churn } = mountWithChurn(wrap);
  await waitFor(() => expect(lastRender()?.rowFieldLabel).toBeDefined());
  const afterFirstDerive = src.getObjectSchema.mock.calls.length;

  churn(3);
  await settle();
  const rendersAtQuiesce = captured.renders.length;
  await settle();

  return {
    afterFirstDerive,
    schemaCalls: src.getObjectSchema.mock.calls.length,
    rendersAtQuiesce,
    rendersAfterQuietWindow: captured.renders.length,
    rowLabelIdentities: distinct((r) => r.rowLabels).size,
    rowFieldLabels: [...distinct((r) => r.rowFieldLabel)],
    optionLabel: lastRender()?.rowLabels?.won,
  };
}

describe('ObjectPivotTable — i18n resolvers are direct effect dependencies (objectui#5625)', () => {
  it('derives once across re-renders with NO i18next provider, and both maps settle', async () => {
    const seen = await deriveAcrossRerenders((el) => el);

    // The effect ran exactly once across mount + 3 forced re-renders.
    expect(seen.afterFirstDerive).toBe(1);
    expect(seen.schemaCalls).toBe(1);

    // Settle check, both derived maps: `fieldLabelMaps` was stored once...
    expect(seen.rowLabelIdentities).toBe(1);
    // ...and so was `fieldNameLabels`. Raw values here are also the
    // precondition: a leaked global instance would localize these and turn this
    // case into a duplicate of the next one.
    expect(seen.rowFieldLabels).toEqual([RAW_FIELD_LABEL]);
    expect(seen.optionLabel).toBe(RAW_OPTION_LABEL);

    // Nothing was still scheduling work when we stopped looking.
    expect(seen.rendersAfterQuietWindow).toBe(seen.rendersAtQuiesce);
  });

  it('derives once across re-renders INSIDE an i18next provider, and both maps settle', async () => {
    const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    // `getAppNamespaces()` only discovers a top-level key carrying one of its
    // marker sub-keys; `fields` is both the marker and the entry `fieldLabel`
    // reads, and `fieldOptions` is what `fieldOptionLabel` reads.
    instance.addResourceBundle('en', 'translation', {
      crm: {
        fields: { deal: { stage: 'Stage (en)' } },
        fieldOptions: { deal: { stage: { won: 'Won (en)' } } },
      },
    }, true, true);

    const seen = await deriveAcrossRerenders((el) => (
      <I18nProvider instance={instance} persistLanguage={false}>{el}</I18nProvider>
    ));

    expect(seen.afterFirstDerive).toBe(1);
    expect(seen.schemaCalls).toBe(1);
    expect(seen.rowLabelIdentities).toBe(1);
    // The resolvers really ran through the bound instance — so this case and
    // the one above exercise two different identity paths, not one twice.
    expect(seen.rowFieldLabels).toEqual(['Stage (en)']);
    expect(seen.optionLabel).toBe('Won (en)');
    expect(seen.rendersAfterQuietWindow).toBe(seen.rendersAtQuiesce);
  });

  it('re-derives exactly once when the resolver genuinely changes (language switch)', async () => {
    // This is the case the REMOVAL buys, and the one the ref made impossible:
    // with the resolvers hidden behind refs the effect's deps were
    // `[dataSource, schema.objectName]`, neither of which a language switch
    // moves, so the pivot kept rendering `Stage (en)` / `Won (en)` afterwards.
    const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    instance.addResourceBundle('en', 'translation', {
      crm: {
        fields: { deal: { stage: 'Stage (en)' } },
        fieldOptions: { deal: { stage: { won: 'Won (en)' } } },
      },
    }, true, true);
    instance.addResourceBundle('ja', 'translation', {
      crm: {
        fields: { deal: { stage: 'Stage (ja)' } },
        fieldOptions: { deal: { stage: { won: 'Won (ja)' } } },
      },
    }, true, true);

    const { src, churn } = mountWithChurn((el) => (
      <I18nProvider instance={instance} persistLanguage={false}>{el}</I18nProvider>
    ));

    await waitFor(() => expect(lastRender()?.rowFieldLabel).toBe('Stage (en)'));
    expect(src.getObjectSchema.mock.calls.length).toBe(1);
    expect(lastRender()?.rowLabels?.won).toBe('Won (en)');

    await act(async () => { await instance.changeLanguage('ja'); });

    await waitFor(() => expect(lastRender()?.rowFieldLabel).toBe('Stage (ja)'));
    expect(lastRender()?.rowLabels?.won).toBe('Won (ja)');
    // Exactly ONE more derivation — the switch is a real dependency change, not
    // a licence to re-derive on every subsequent render.
    expect(src.getObjectSchema.mock.calls.length).toBe(2);

    // ...and it settles again on the new language.
    churn(3);
    await settle();
    const rendersAtQuiesce = captured.renders.length;
    await settle();
    expect(captured.renders.length).toBe(rendersAtQuiesce);
    expect(src.getObjectSchema.mock.calls.length).toBe(2);
  });
});
