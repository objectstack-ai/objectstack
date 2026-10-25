// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The FOURTH option-picker loader must tell a FAULT from a MEASUREMENT —
 * objectui#5227.
 *
 * ## The defect, and why it had two mouths
 *
 * `FieldSelectorWidget` is the one loader in this family that does not go
 * through `MetadataClient`: a raw `fetch` to `/api/v1/objects/:name/fields`,
 * its own component-local `fields` / `loading` state, no `WidgetContext`. That
 * is why objectui#5170 fixed the three `ResourceEditPage` pickers and left this
 * one, and why the `catalogErrors` channel PR #5226 added never reached it.
 *
 * It could reach a false "no fields" two different ways:
 *
 *   1. the `catch` wrote `setFields([])` — the exact value a SUCCESSFUL empty
 *      response writes — and cleared the loading flag;
 *   2. it never checked `res.ok`, so a non-ok response whose body happens to
 *      parse as JSON landed in the SUCCESS branch, where `data.fields || []`
 *      spelled the refusal as an empty catalog. No error was raised at all on
 *      this path, so a union guarding only mouth 1 would have left it open.
 *
 * Hence the triple is pinned PER MOUTH: a fix that only rewrote the `catch`
 * passes the first failure case and fails the second.
 *
 * ## What is pinned
 *
 *   1. a FAILED load (network error) renders the failure state, NOT a picker;
 *   2. a NON-OK response with a JSON body does the same — mouth 2;
 *   3. a genuinely EMPTY SUCCESSFUL load still renders the picker, disabled.
 *      This is what stops (1) and (2) being tautologies: had the fix bought
 *      honesty by deleting the empty rendering, every "not an empty list"
 *      assertion would pass for the wrong reason;
 *   4. the loading arm clears in every case, asserted in both directions — a
 *      held promise proves the arm is reachable, so "no longer loading" is not
 *      vacuous.
 *
 * ## Why these observables — measured, not assumed
 *
 * PR #5226 recorded that Radix `SelectValue` does not render its `placeholder`
 * in jsdom. That measurement was taken on `field-ref`, and it does NOT carry
 * here: `field-ref` holds `value={current || NO_FIELD}`, so an item always
 * matches and its text wins over the placeholder. This widget holds `value=""`
 * with no matching item, and the placeholder DOES render. Re-measured on this
 * widget rather than inherited:
 *
 *   completed, catalog empty      → trigger reads "Add fields…"
 *   completed, catalog populated  → trigger reads "Add fields…"   (identical)
 *   single-select, catalog empty  → trigger reads "Select field…"
 *   failed                        → no trigger at all
 *
 * So the placeholder cannot tell a MEASURED-empty catalog from a populated one
 * — it is the same string — and an assertion on it would pass for both. What it
 * can do is separate a completed load from a failed one, because the failure
 * arm renders no picker; that direction is asserted below, in both polarities,
 * alongside the structural reads: the failure block by its test id, the loading
 * arm by its disabled input, the completed arms by the combobox they render.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { WIDGETS } from './widgets';
import { t } from './i18n';

const FieldSelector = WIDGETS['field-selector'];

const OBJECT = 'showcase_account';
const FIELDS_URL = `/api/v1/objects/${OBJECT}/fields`;

/** Shown while the catalog request is genuinely in flight. */
const LOADING_FIELDS = t('engine.form.loadingFields', 'en-US');
/** The heading of the shared failure block (`PickerLoadFailure`). */
const LOAD_FAILED_TITLE = t('engine.form.optionsLoadFailedTitle', 'en-US');

const FAILURE_TESTID = 'field-selector-load-failed';
/**
 * What the trigger reads on a COMPLETED load, measured (see the header).
 * `multiple` is true for every case here except where stated, so this is the
 * sentence a false empty used to show an operator.
 */
const ADD_FIELDS = t('engine.form.addFields', 'en-US');

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function jsonErrorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

/** A promise the test resolves by hand, so the loading arm is observable. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderWidget(props: Record<string, unknown> = {}) {
  return render(
    <FieldSelector
      id="field_selector"
      value=""
      onChange={() => {}}
      schema={{ type: 'string' }}
      fieldSpec={{ field: 'fields', multiple: true }}
      formData={{ objectName: OBJECT }}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('field-selector — a failed field fetch is not an empty field list (objectui#5227)', () => {
  it('mouth 1: a REJECTED fetch renders the failure block and no picker', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('NetworkError: failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();

    // The loading arm is reachable and then leaves — not vacuous, the widget
    // starts in `loading` because an object IS bound on first paint.
    expect(screen.getByDisplayValue(LOADING_FIELDS)).toBeDisabled();

    await waitFor(() => expect(screen.getByTestId(FAILURE_TESTID)).toBeInTheDocument());
    expect(screen.getByText(LOAD_FAILED_TITLE)).toBeInTheDocument();
    // The cause reaches the operator instead of only `console.error`.
    expect(screen.getByTestId(`${FAILURE_TESTID}-cause`)).toHaveTextContent(
      'NetworkError: failed to fetch',
    );

    // NOT an empty field list: the picker is absent, so neither the trigger
    // nor its copy is on screen to be read as "this object has no fields".
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(ADD_FIELDS)).not.toBeInTheDocument();
    // …and the loading flag cleared.
    expect(screen.queryByDisplayValue(LOADING_FIELDS)).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(FIELDS_URL);
  });

  it('mouth 2: a NON-OK response with a parseable JSON body is a fault, not an empty catalog', async () => {
    // The shape that used to land in the SUCCESS branch: `res.json()` resolves,
    // `data.fields` is undefined, and `|| []` rendered the refusal as "no fields".
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonErrorResponse(403, { error: { message: 'Insufficient permissions' } }));
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();

    await waitFor(() => expect(screen.getByTestId(FAILURE_TESTID)).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(ADD_FIELDS)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(LOADING_FIELDS)).not.toBeInTheDocument();
    // The server's own sentence, not a generic one.
    expect(screen.getByTestId(`${FAILURE_TESTID}-cause`)).toHaveTextContent(
      'Insufficient permissions',
    );
  });

  it('mouth 2: a NON-OK response with no usable message still fails with its status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      // A non-JSON body — the parse throws, and that must not be mistaken for
      // a refusal that said nothing to report.
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();

    await waitFor(() => expect(screen.getByTestId(FAILURE_TESTID)).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByTestId(`${FAILURE_TESTID}-cause`)).toHaveTextContent('HTTP 500');
  });

  it('a genuinely EMPTY successful load still renders the picker, and no failure block', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ fields: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();

    // This arm is what stops the assertions above being tautologies: the empty
    // measurement is still rendered, it is just no longer where a fault lands.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toBeDisabled();
    // The measurement is still spelled out — the fix bought honesty about the
    // fault without deleting the case where "nothing here" is true.
    expect(screen.getByText(ADD_FIELDS)).toBeInTheDocument();
    expect(screen.queryByTestId(FAILURE_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(LOADING_FIELDS)).not.toBeInTheDocument();
  });

  it('a POPULATED successful load renders an enabled picker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ fields: [{ name: 'name', label: 'Name', type: 'text' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();

    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    expect(screen.queryByTestId(FAILURE_TESTID)).not.toBeInTheDocument();
  });

  it('the loading arm is held, then clears — asserted in both directions', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(gate.promise);
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();

    // Held: still asking, so neither an answer nor a failure is on screen.
    expect(screen.getByDisplayValue(LOADING_FIELDS)).toBeDisabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByTestId(FAILURE_TESTID)).not.toBeInTheDocument();

    gate.resolve(okResponse({ fields: [{ name: 'name', label: 'Name', type: 'text' }] }));

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(screen.queryByDisplayValue(LOADING_FIELDS)).not.toBeInTheDocument();
  });

  it('the loading arm clears into the failure arm too (held, then rejected)', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(gate.promise);
    vi.stubGlobal('fetch', fetchMock);

    renderWidget();

    expect(screen.getByDisplayValue(LOADING_FIELDS)).toBeDisabled();

    gate.reject(new Error('connection reset'));

    await waitFor(() => expect(screen.getByTestId(FAILURE_TESTID)).toBeInTheDocument());
    expect(screen.queryByDisplayValue(LOADING_FIELDS)).not.toBeInTheDocument();
  });

  it('no object bound is IDLE, not a failure — nothing is fetched', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderWidget({ formData: {} });

    // A question never asked must not render as an answer of none, nor as a
    // fault: the widget asks for an object first and stays silent.
    expect(
      screen.getByDisplayValue(t('engine.form.selectObjectFirst', 'en-US')),
    ).toBeDisabled();
    expect(screen.queryByTestId(FAILURE_TESTID)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed catalog does not also block authoring — the stored value stays visible and removable', async () => {
    const onChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderWidget({ value: ['amount'], onChange });

    await waitFor(() => expect(screen.getByTestId(FAILURE_TESTID)).toBeInTheDocument());
    // The chip for the already-stored field is still there…
    expect(screen.getByText('amount')).toBeInTheDocument();
    // …and still editable.
    screen.getByRole('button', { name: '×' }).click();
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
