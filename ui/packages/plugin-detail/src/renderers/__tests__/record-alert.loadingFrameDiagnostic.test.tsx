/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * objectui#5776 — the loading-frame `record is not defined` false positive
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `record:alert`'s `visible` predicate is evaluated on EVERY render (Rules of
 * Hooks — `useCondition` cannot be called conditionally), including the frame
 * before `useRecordContext().data` has loaded. In that frame `record` is
 * `undefined`/`null`, `usePredicateRecordContext` binds an EMPTY context bag
 * (no `record` key at all — see its own doc: "No row → bind NOTHING"), and a
 * bare/`${…}` predicate referencing `record.*` faults with a bare
 * `ReferenceError: record is not defined` — logged via
 * `ExpressionEvaluator.evaluate`'s `console.warn`. The banner itself still
 * renders correctly (hidden while unloaded, then shown/hidden per the
 * predicate once `record` populates), so this is a diagnostic defect, not a
 * behavior one: the SAME predicate that works is blamed every load.
 *
 * The fix must be a PAIR: the loading frame stops logging (this file's first
 * test, both polarities), and a predicate that is genuinely broken — for a
 * reason that has nothing to do with the record not having loaded yet — still
 * logs once `record` is populated (this file's second test). A change that
 * only satisfied the first half would pass equally if the diagnostic had been
 * deleted outright; the second half is what tells the two apart.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const stub = {
  recordCtx: undefined as any,
  metadataItem: undefined as any,
};

// Same doubling strategy as `record-alert.test.tsx` (objectui#3941): only the
// DATA layer is doubled — `toPredicateInput` / `useCondition` and the ambient
// `PredicateScopeProvider` are the REAL shipped pipeline, so a defect in
// normalization or evaluation (this card's subject) is observable here.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useRecordContext: () => stub.recordCtx,
    useMetadataItem: (_type: string, _name: string | null) => ({ item: stub.metadataItem }),
    useActionEngine: (_opts: unknown) => ({
      executeAction: vi.fn(async () => ({ success: true })),
      getActionsForLocation: () => [],
      getBulkActions: () => [],
      handleShortcut: async () => null,
      engine: {} as any,
    }),
  };
});

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Alert: ({ children, className, role, ...rest }: any) => (
    <div data-testid="alert" role={role} className={className} {...rest}>
      {children}
    </div>
  ),
  AlertTitle: ({ children }: any) => <h5 data-testid="alert-title">{children}</h5>,
  AlertDescription: ({ children }: any) => <div data-testid="alert-body">{children}</div>,
  Button: ({ children, onClick, variant, ...rest }: any) => (
    <button data-testid="alert-cta" data-variant={variant} onClick={onClick} {...rest}>
      {children}
    </button>
  ),
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  LazyIcon: ({ name, className }: any) => (
    <svg data-testid="alert-icon" data-name={name} className={className} />
  ),
}));

import { RecordAlertRenderer } from '../record-alert';

beforeEach(() => {
  stub.metadataItem = undefined;
  cleanup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TITLE = 'Verify your email';
const PRED = "record.status == 'in_review'"; // bare string — the page-block predicate shape from the card

function schema(visible: unknown) {
  return { properties: { title: TITLE, visible } };
}

/**
 * Filter a `console.warn` spy down to the evaluation-failure diagnostic this
 * card is about — not an assertion of TOTAL silence. `useObjectTranslation`
 * (i18next) warns unrelated to this card in the same environment (no
 * `I18nProvider` is mounted here — see `record-alert.test.tsx`'s equivalent
 * locale-map test for the real provider), and coupling this pin to that
 * unrelated noise would make it fail for a reason that has nothing to do
 * with objectui#5776.
 */
function evaluationFailureWarnings(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((m: string) => /Failed to evaluate expression/.test(m));
}

describe('record:alert — loading-frame evaluation diagnostic (objectui#5776)', () => {
  it('logs nothing while the record is loading, then evaluates correctly with no noise once it loads — both polarities', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // --- Polarity 1: predicate ultimately HOLDS -------------------------
    stub.recordCtx = { data: undefined, objectName: 'sys_user', recordId: 'rec_1' };
    const holds = render(<RecordAlertRenderer schema={schema(PRED)} />);
    // Loading frame: hidden (existing contract), and — the defect — no
    // misleading "record is not defined" noise for a predicate that works.
    expect(holds.container.firstChild).toBeNull();
    expect(evaluationFailureWarnings(warnSpy)).toEqual([]);

    // Frame 2: record loads, predicate holds → banner shows, still silent.
    stub.recordCtx = { data: { id: 'rec_1', status: 'in_review' }, objectName: 'sys_user', recordId: 'rec_1' };
    holds.rerender(<RecordAlertRenderer schema={schema(PRED)} />);
    expect(screen.getByTestId('alert')).toBeTruthy();
    expect(evaluationFailureWarnings(warnSpy)).toEqual([]);

    cleanup();
    warnSpy.mockClear();

    // --- Polarity 2: predicate ultimately FAILS (banner correctly hidden) -
    stub.recordCtx = { data: undefined, objectName: 'sys_user', recordId: 'rec_1' };
    const fails = render(<RecordAlertRenderer schema={schema(PRED)} />);
    expect(fails.container.firstChild).toBeNull();
    expect(evaluationFailureWarnings(warnSpy)).toEqual([]);

    stub.recordCtx = { data: { id: 'rec_1', status: 'approved' }, objectName: 'sys_user', recordId: 'rec_1' };
    fails.rerender(<RecordAlertRenderer schema={schema(PRED)} />);
    expect(fails.queryByTestId('alert')).toBeNull();
    expect(evaluationFailureWarnings(warnSpy)).toEqual([]);
  });

  it('a genuinely-broken predicate still logs once the record has loaded (the pairing half)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Record is fully loaded — this is NOT the loading frame — and the
    // predicate references a field that will never resolve, for reasons
    // unrelated to loading (an authoring typo). The suppression above must
    // not swallow this: an author with a genuinely broken predicate still
    // needs the console line.
    stub.recordCtx = { data: { id: 'rec_1', status: 'in_review' }, objectName: 'sys_user', recordId: 'rec_1' };
    const BROKEN = "bogus_unbound_field.status == 'x'";
    render(<RecordAlertRenderer schema={schema(BROKEN)} />);

    expect(evaluationFailureWarnings(warnSpy).length).toBeGreaterThan(0);
  });
});
