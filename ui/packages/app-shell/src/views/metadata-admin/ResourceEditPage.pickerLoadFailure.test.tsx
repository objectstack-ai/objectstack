// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The three option-picker loaders must tell a FAULT from a MEASUREMENT —
 * objectui#5170.
 *
 * ## The defect
 *
 * `ResourceEditPage` fed its option pickers from three effects — the object
 * name list, the bound object's fields + actions, and the bound object's views.
 * All three caught a failed load by writing the value a SUCCESSFUL empty
 * response writes, then flipped loading to false:
 *
 *     } catch {
 *       if (!cancelled) setObjectNames([]);
 *     } finally { if (!cancelled) setObjectsLoading(false); }
 *
 * The picker then rendered as a completed, empty list. There was no error
 * state, no banner, and — unlike objectui#5110, which at least left a
 * `console.error` — no trace of any kind. `client.list()` / `client.get()`
 * throw for every non-ok status other than the 404s they map to an empty
 * result, so refusals, dropped connections, expired sessions and unparseable
 * bodies were all rendered as "there is nothing here".
 *
 * What made it user-visible is that the pickers' empty-state copy is not
 * neutral. It NAMES A CAUSE, and on a failed load the cause it names is false:
 * `ref:object` says "object_name (no objects detected)" — a measurement — and
 * `field-ref` / `view-ref` say "No object bound" when an object IS bound. An
 * operator authoring a view, a permission row or an action reads that as the
 * metadata graph's answer, and an author who concludes "this object has no
 * fields" tends to go and create one.
 *
 * ## What is pinned, per loader
 *
 * The same triple three times, because the bug lives entirely in the `catch`
 * and a happy-path test cannot see it:
 *
 *   1. a FAILED load renders the failure state and NOT an empty list;
 *   2. a genuinely EMPTY SUCCESSFUL load still renders the empty list — the
 *      case the fix must not buy honesty by deleting;
 *   3. the loading flag clears in both.
 *
 * Case 2 is what stops case 1 being a tautology: if the fix had removed the
 * empty rendering altogether, every "not an empty list" assertion would pass
 * for the wrong reason. Case 3 is asserted in both directions — a held promise
 * proves the loading arm is reachable, so the "no longer loading" assertions
 * are not vacuous either.
 *
 * ## Why these observables and not the placeholder copy
 *
 * Measured, not assumed: Radix `SelectValue` does not render its `placeholder`
 * in jsdom — a closed trigger shows the selected item's text instead, so the
 * document text for an empty `field-ref` is just "— None —". Asserting on
 * "No object bound" would therefore have PASSED for every arm and pinned
 * nothing. So each arm is made structurally distinct instead and the assertions
 * read the structure: the failure block by test id, the loading arm by its
 * disabled input, the loaded arm by the combobox it renders.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { t } from './i18n';

/** The sentence the object picker shows for a COMPLETED, empty list. */
const NO_OBJECTS = t('engine.form.noObjects', 'en-US');
/** Shown while a catalog request is genuinely in flight. */
const LOADING_OBJECTS = t('engine.form.loadingObjects', 'en-US');
const LOADING_OPTIONS = t('engine.form.loadingOptions', 'en-US');

const SOURCE_OBJECT = 'showcase_account';

/**
 * The draft baseline. `object` is what makes `sourceObjectName` resolve, which
 * is what enables the field and view loaders at all.
 */
const EFFECTIVE = {
  name: SOURCE_OBJECT,
  label: 'Account',
  object: SOURCE_OBJECT,
};

const LAYERED = {
  code: { ...EFFECTIVE, _packageId: 'com.example.showcase', _provenance: 'package' },
  overlay: null,
  effective: { ...EFFECTIVE },
  provenance: 'package',
  packageId: 'com.example.showcase',
  editable: true,
  deletable: true,
  resettable: true,
};

/**
 * Swapped per case. Each loader gets its own impl so a test can fail exactly
 * one catalog and leave the other two healthy — which is what lets an assertion
 * be attributed to the loader under test.
 */
const impl = {
  listObject: vi.fn<() => Promise<Array<{ name?: string }>>>(),
  listView: vi.fn<() => Promise<Array<Record<string, unknown>>>>(),
  getObject: vi.fn<() => Promise<unknown>>(),
};

/** Only the property under test, so exactly one picker is on the page. */
const schemaProps = { current: {} as Record<string, unknown> };

const mockClient = {
  list: vi.fn(async (type: string) =>
    type === 'view' ? impl.listView() : impl.listObject(),
  ),
  get: vi.fn(async () => impl.getObject()),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async () => null),
  layered: vi.fn(async () => LAYERED),
  reset: vi.fn(async () => ({ success: true })),
  references: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        {
          type: 'object',
          name: 'object',
          label: 'Object',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: { type: 'object', properties: schemaProps.current },
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage, viewRefCatalog } from './ResourceEditPage';

function mountEditor() {
  render(
    <MemoryRouter initialEntries={[`/metadata/object/${SOURCE_OBJECT}`]}>
      <Routes>
        <Route
          path="/metadata/:type/:name"
          element={<MetadataResourceEditPage type="object" name={SOURCE_OBJECT} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
}

/** A promise this test controls the settling of — the `loading` arm. */
function heldPromise<T>() {
  let settle!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    settle = res;
    fail = rej;
  });
  return { promise, settle, fail };
}

beforeEach(() => {
  // Healthy defaults; each test breaks exactly one of them.
  impl.listObject.mockImplementation(async () => [
    { name: SOURCE_OBJECT },
    { name: 'showcase_task' },
  ]);
  impl.listView.mockImplementation(async () => [
    // `object`, the spelling the spec declares on a view row (objectui#11013).
    { name: `${SOURCE_OBJECT}.default`, label: 'All records', object: SOURCE_OBJECT },
  ]);
  impl.getObject.mockImplementation(async () => ({
    fields: { title: { label: 'Title', type: 'text' } },
    actions: [{ name: 'approve', label: 'Approve' }],
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Loader 1 — the object name list (`ref:object`)                             */
/* -------------------------------------------------------------------------- */

describe('object-name loader: a failed list is not an empty list (#5170)', () => {
  beforeEach(() => {
    schemaProps.current = { object: { type: 'string', widget: 'ref:object' } };
  });

  it('loading: while the list is in flight the picker says so, and claims nothing', async () => {
    const held = heldPromise<Array<{ name?: string }>>();
    impl.listObject.mockImplementation(() => held.promise);

    await mountEditor();

    expect(await screen.findByPlaceholderText(LOADING_OBJECTS)).toBeInTheDocument();
    expect(screen.queryByTestId('ref-object-load-failed')).toBeNull();
    // The measurement must not be on screen before it has been measured.
    expect(screen.queryByPlaceholderText(NO_OBJECTS)).toBeNull();

    held.settle([]);
    await screen.findByPlaceholderText(NO_OBJECTS);
  });

  it('empty success: a completed list of zero objects still renders the empty state', async () => {
    impl.listObject.mockImplementation(async () => []);

    await mountEditor();

    // The one case where "no objects detected" is a true statement. Keeping it
    // is what makes the failure case's absence assertion meaningful.
    expect(await screen.findByPlaceholderText(NO_OBJECTS)).toBeInTheDocument();
    expect(screen.queryByTestId('ref-object-load-failed')).toBeNull();
    // The loading flag cleared.
    expect(screen.queryByPlaceholderText(LOADING_OBJECTS)).toBeNull();
  });

  it('failure: the failure is shown as a failure, never as "no objects detected"', async () => {
    impl.listObject.mockImplementation(async () => {
      throw new Error('403 Forbidden: metadata read refused');
    });

    await mountEditor();

    const panel = await screen.findByTestId('ref-object-load-failed');
    expect(panel).toBeInTheDocument();

    // 1. The claim that must not appear anywhere in the document. Read from the
    //    table so a reword of the empty copy cannot quietly narrow this.
    expect(screen.queryByPlaceholderText(NO_OBJECTS)).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(NO_OBJECTS);

    // 2. What IS said: the list did not load, plus the cause — and no claim in
    //    either direction about whether objects exist.
    expect(screen.getByText(t('engine.form.optionsLoadFailedTitle', 'en-US'))).toBeInTheDocument();
    expect(screen.getByTestId('ref-object-load-failed-cause')).toHaveTextContent(
      '403 Forbidden: metadata read refused',
    );

    // 3. The loading flag cleared here too — a failure is settled, not pending.
    expect(screen.queryByPlaceholderText(LOADING_OBJECTS)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Loader 2 — the bound object's fields + actions (`field-ref`)                */
/* -------------------------------------------------------------------------- */

describe('field-catalog loader: a failed get is not an object without fields (#5170)', () => {
  beforeEach(() => {
    schemaProps.current = { titleField: { type: 'string' } };
  });

  it('loading: the picker reports that it is still asking', async () => {
    const held = heldPromise<unknown>();
    impl.getObject.mockImplementation(() => held.promise);

    await mountEditor();

    expect(await screen.findByDisplayValue(LOADING_OPTIONS)).toBeInTheDocument();
    expect(screen.queryByTestId('field-ref-load-failed')).toBeNull();

    held.settle({ fields: {} });
    await waitFor(() => expect(screen.queryByDisplayValue(LOADING_OPTIONS)).toBeNull());
  });

  it('empty success: an object that genuinely has no fields still renders the picker', async () => {
    impl.getObject.mockImplementation(async () => ({ fields: {}, actions: [] }));

    await mountEditor();

    // A completed read of an object with no fields renders the field picker
    // (empty), NOT a failure — the arm the failure case must be distinct from.
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('field-ref-load-failed')).toBeNull();
    expect(screen.queryByDisplayValue(LOADING_OPTIONS)).toBeNull();
  });

  it('failure: the failure replaces the picker instead of rendering it empty', async () => {
    impl.getObject.mockImplementation(async () => {
      throw new Error('503 Service Unavailable');
    });

    await mountEditor();

    expect(await screen.findByTestId('field-ref-load-failed')).toBeInTheDocument();
    // Not an empty list: the picker that would have offered zero fields is gone.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('field-ref-load-failed-cause')).toHaveTextContent(
      '503 Service Unavailable',
    );
    expect(screen.queryByDisplayValue(LOADING_OPTIONS)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Loader 3 — the bound object's views (`view-ref`)                            */
/* -------------------------------------------------------------------------- */

describe('view-catalog loader: a failed list is not an object without views (#5170)', () => {
  beforeEach(() => {
    schemaProps.current = { sourceView: { type: 'string', widget: 'view-ref' } };
  });

  it('loading: the picker reports that it is still asking', async () => {
    const held = heldPromise<Array<Record<string, unknown>>>();
    impl.listView.mockImplementation(() => held.promise);

    await mountEditor();

    expect(await screen.findByDisplayValue(LOADING_OPTIONS)).toBeInTheDocument();
    expect(screen.queryByTestId('view-ref-load-failed')).toBeNull();

    held.settle([]);
    await waitFor(() => expect(screen.queryByDisplayValue(LOADING_OPTIONS)).toBeNull());
  });

  it('empty success: an object that genuinely has no views still renders the picker', async () => {
    impl.listView.mockImplementation(async () => []);

    await mountEditor();

    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('view-ref-load-failed')).toBeNull();
    expect(screen.queryByDisplayValue(LOADING_OPTIONS)).toBeNull();
  });

  it('failure: the failure replaces the picker instead of rendering it empty', async () => {
    impl.listView.mockImplementation(async () => {
      throw new Error('Failed to fetch');
    });

    await mountEditor();

    expect(await screen.findByTestId('view-ref-load-failed')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('view-ref-load-failed-cause')).toHaveTextContent(
      'Failed to fetch',
    );
    expect(screen.queryByDisplayValue(LOADING_OPTIONS)).toBeNull();
  });

  it('objectui#11013: the catalog keeps a view bound by `object`, and not one that carries only `objectName`', () => {
    // The loader hands `client.list('view')` to `viewRefCatalog`, which reads
    // the row's binding under the one spelling the spec declares. `objectName`
    // and `object_name` are declared on no `view` member, so the metadata door
    // refuses a row bound by either alone.
    const catalog = viewRefCatalog(
      [
        { name: `${SOURCE_OBJECT}.declared`, label: 'Declared binding', object: SOURCE_OBJECT },
        { name: `${SOURCE_OBJECT}.undeclared`, label: 'Undeclared binding', objectName: SOURCE_OBJECT },
        { name: `${SOURCE_OBJECT}.snake`, label: 'Snake binding', object_name: SOURCE_OBJECT },
        { name: 'showcase_task.other', label: 'Other object', object: 'showcase_task' },
      ],
      SOURCE_OBJECT,
    );
    expect(catalog).toEqual([{ name: `${SOURCE_OBJECT}.declared`, label: 'Declared binding' }]);
  });

  it('the field catalog failing does not take the view picker down with it', async () => {
    // The two loaders are separate requests and must stay separately
    // attributable — one catalog's fault is not evidence about another's.
    impl.getObject.mockImplementation(async () => {
      throw new Error('503 Service Unavailable');
    });

    await mountEditor();

    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('view-ref-load-failed')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The copy itself                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The designer table carries `en` and `zh` in one file and is deliberately out
 * of reach of the pack gates (see `metadata-admin/i18n.ts`'s header), so a key
 * added to only one of the two tables fails nowhere. This is that file's parity
 * check for the keys this card adds.
 *
 * The semantic property — the failure copy asserts nothing about whether
 * options exist — is NOT mechanically checkable and is not claimed to be. What
 * is checkable is the fact that made the defect, and it is asserted: the
 * failure copy is not the empty copy, in either locale.
 */
describe('picker failure copy (#5170)', () => {
  it('exists in both locales and is not the empty copy', () => {
    for (const key of [
      'engine.form.optionsLoadFailedTitle',
      'engine.form.optionsLoadFailedDesc',
      'engine.form.loadingOptions',
    ] as const) {
      const en = t(key, 'en-US');
      const zh = t(key, 'zh-CN');
      // `t()` echoes the key back when the table has no entry for it.
      expect(en, `EN missing ${key}`).not.toBe(key);
      expect(zh, `ZH missing ${key}`).not.toBe(key);
      expect(en, `${key} is untranslated`).not.toBe(zh);
    }

    for (const locale of ['en-US', 'zh-CN'] as const) {
      const failure = t('engine.form.optionsLoadFailedDesc', locale);
      for (const emptyKey of ['engine.form.noObjects', 'engine.form.noObjectBound'] as const) {
        expect(failure, `${locale} failure copy collapsed into ${emptyKey}`).not.toBe(
          t(emptyKey, locale),
        );
        expect(failure).not.toContain(t(emptyKey, locale));
      }
    }
  });
});
