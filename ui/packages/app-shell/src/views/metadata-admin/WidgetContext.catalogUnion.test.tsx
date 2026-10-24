// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `WidgetContext` option catalog carries its own load state, and a picker
 * cannot read the list without deciding what a failure looks like —
 * objectui#5228.
 *
 * ## The residue this closes
 *
 * objectui#5170 / objectui#5169 stopped the three `ResourceEditPage` loaders
 * spelling a fault as a measurement, but the fix was projected back down at the
 * `WidgetContext` boundary: the catalogs stayed plain arrays — `[]` on a failed
 * load, byte-identical to a load that completed and found nothing — and the
 * fault travelled alongside them on a `catalogErrors` record. Nothing in the
 * types said so. The requirement lived in `CatalogErrors`' own doc comment,
 * which had to open with "a picker MUST consult this before it renders its
 * catalog", and one line was enough to ignore it:
 *
 *     const fields = context?.objectFields ?? [];
 *
 * — type-correct, natural to read, passes review, and renders a refusal or an
 * expired session as the metadata graph's own answer of "this object has no
 * fields". A comment doing a type's job.
 *
 * ## What is pinned here, and by which tool
 *
 * Two halves, and they fail in different places on purpose:
 *
 *   • **`tsc`** — the `@ts-expect-error` block below. These assertions are
 *     erased at runtime, so vitest proves nothing about them; the package's
 *     `type-check` script (`tsc -p tsconfig.test.json`, which is the only
 *     project that compiles this directory's tests) is what judges them. Each
 *     one is a two-way pin: `@ts-expect-error` is itself an error (TS2578) when
 *     the line below it starts compiling, so loosening the contract turns this
 *     file red rather than quietly passing.
 *   • **vitest** — the render blocks. A COMPLETED-but-empty catalog and a
 *     FAILED catalog reach every migrated picker as different values and come
 *     out as different screens, asserted in both directions. The empty arm is
 *     what stops the failure assertions being tautologies: had the union been
 *     bought by deleting the empty rendering, "not an empty list" would pass
 *     for the wrong reason everywhere.
 *
 * Every failure arm renders the SHARED `PickerLoadFailure` block, the one
 * objectui#5170 landed and objectui#5227 reused — asserted by its test id and
 * its heading, so a second, bespoke failure presentation fails here.
 *
 * ## Why the observables are structural
 *
 * Measured by PR #5226 and re-confirmed: Radix `SelectValue` does not render
 * its `placeholder` in jsdom, so asserting on "No object bound" would pass for
 * every arm and pin nothing. Each arm is read by structure instead — the
 * failure block by test id, the completed arms by the control they render and
 * by the empty-state sentences that are plain text rather than placeholders.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { WIDGETS, type RegisteredWidgetKey, type WidgetProps } from './widgets';
import { t } from './i18n';
import { loaded, failed, NOT_ASKED, offeredOptions, type LoadState } from './loadState';
import type {
  ObjectActionOption,
  ObjectFieldOption,
  ObjectViewOption,
  WidgetContext,
} from './widgets';

// `filter-builder` keeps its failure block inside a Radix popover, which does
// not open in jsdom. Rendering the popover parts inline is this repo's existing
// way of reaching such content in a unit test (see the `InboxPopover` suites);
// everything else in the barrel stays real. No JSX in the factory: `vi.mock` is
// hoisted above the imports, so the factory must not depend on them.
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});

afterEach(cleanup);

const CAUSE = 'HTTP 503: metadata service unavailable';
/** The heading of the one shared failure block every picker must use. */
const LOAD_FAILED_TITLE = t('engine.form.optionsLoadFailedTitle', 'en-US');
/** What `ref:object` says for a COMPLETED list of zero objects — a MEASUREMENT. */
const NO_OBJECTS = t('engine.form.noObjects', 'en-US');

/* ========================================================================== */
/* 1. Compile-time: the failure arm cannot be skipped                          */
/* ========================================================================== */

/**
 * These never run. They are the half of this card that a runtime test cannot
 * express — "a call site that ignores the failure arm does not compile" is a
 * statement about `tsc`, not about the DOM.
 */
export function catalogUnionTypePins(): void {
  const failedFields: WidgetContext = { conditionScope: 'flattened', objectFields: failed(CAUSE) };

  // ── PIN A — the naive read. This is the exact line objectui#5228 was filed
  // about, and it is the one that must stop compiling. A `LoadState` is not an
  // array, so `?? []` cannot produce a list.
  //
  // Two-way: revert `WidgetContext.objectFields` to `ObjectFieldOption[]` and
  // this line compiles again, which makes the directive unused — TS2578 — so
  // the pin fails on the loosening as well as holding on the tightening.
  // @ts-expect-error — a catalog is a LoadState, not an array to default away
  const naive: ObjectFieldOption[] = failedFields.objectFields ?? [];
  void naive;

  // ── PIN B — the accessor refuses an undecided state. `offeredOptions` takes
  // `FaultFreeLoadState`, so a caller still holding the `error` arm cannot read
  // the catalog at all: the failure decision is a PRECONDITION checked by the
  // compiler, not a rule asked for in prose.
  //
  // Two-way in the other direction: widen `FaultFreeLoadState` to include the
  // error arm — the loosening that would restore the old "please remember to
  // check" contract — and this call compiles, making the directive unused.
  const anyArm: LoadState<ObjectFieldOption[]> = failed(CAUSE);
  // @ts-expect-error — the error arm has not been decided yet
  offeredOptions(anyArm, [] as ObjectFieldOption[]);

  // ── PIN B, positive control. Without this, PIN B would also pass if
  // `offeredOptions` were simply uncallable. Once the failure is decided, the
  // very same state is accepted and yields the list.
  if (anyArm.status !== 'error') {
    const options: ObjectFieldOption[] = offeredOptions(anyArm, []);
    void options;
  }

  // ── PIN C — a fault and a measurement are different TYPES, not the same type
  // with a flag beside it. This is the sentence the card leads with.
  const completedEmpty: { status: 'loaded'; data: ObjectFieldOption[] } = {
    status: 'loaded',
    data: [],
  };
  // @ts-expect-error — a failure cannot be spelled as a completed, empty load
  const conflated: typeof completedEmpty = { status: 'error', message: CAUSE };
  void completedEmpty;
  void conflated;

  // ── PIN D — the side channels are gone, not merely unused. A producer that
  // still tries to route the fault alongside the catalog is refused, so the old
  // shape cannot creep back one key at a time.
  const legacy: WidgetContext = {
    objectFields: loaded([]),
    // @ts-expect-error — `catalogErrors` no longer exists: the arm carries it
    catalogErrors: { fields: CAUSE },
  };
  void legacy;

  const legacyLoading: WidgetContext = {
    objectNames: loaded([]),
    // @ts-expect-error — `objectsLoading` no longer exists: `loading` is an arm
    objectsLoading: true,
  };
  void legacyLoading;

  // ── PIN E — absence is the `idle` arm, and it is a value of the union rather
  // than a fabricated empty list. Compiles; it is here so the substitution every
  // migrated picker performs is itself type-checked.
  //
  // ⚠️ This literal used to be `{}`. It carries `conditionScope` now because
  // objectui#8167 made that member REQUIRED — the one member of this type that
  // is a verdict about the host's surface rather than a catalog it may or may
  // not have fetched. The pin is re-homed, not weakened: its subject is that a
  // CATALOG may be absent, and every catalog is still absent below.
  const unwiredContext: WidgetContext = { conditionScope: 'flattened' };
  const unwired: LoadState<ObjectViewOption[]> = unwiredContext.objectViews ?? NOT_ASKED;
  void unwired;
}

/* ========================================================================== */
/* 2. Runtime: an empty catalog and a failed catalog render differently        */
/* ========================================================================== */

function renderWidget(
  key: RegisteredWidgetKey,
  // The catalogs are this file's subject, so each case states only those. The
  // one member that is NOT a catalog — `conditionScope`, required since
  // objectui#8167 — is supplied here as `'flattened'`, which is the verdict
  // every mount ran under before that member existed, so no case's rendering
  // moves. A case that wants a different verdict passes it in `context`.
  context: Omit<WidgetContext, 'conditionScope'> & Partial<Pick<WidgetContext, 'conditionScope'>>,
  props: Partial<WidgetProps> = {},
) {
  const Widget = WIDGETS[key];
  return render(
    <Widget
      id={`mdf-${String(key)}`}
      value={undefined}
      onChange={() => {}}
      schema={{ type: 'string' }}
      context={{ conditionScope: 'flattened', ...context }}
      {...props}
    />,
  );
}

/**
 * The failure block is present, is the SHARED one, and carries the cause.
 *
 * The heading is looked up WITHIN the block rather than on the document:
 * measured, the ordered-set pickers (`field-multi`, `action-multi`) also put
 * this same sentence in their add-trigger placeholder, so a document-wide
 * `getByText` finds two and throws. That duplication is intended — the trigger
 * has to say why it is empty — and asserting inside the block is what keeps
 * this helper pinning the BLOCK rather than either occurrence of the string.
 */
function expectSharedFailure(testId: string) {
  const block = screen.getByTestId(testId);
  expect(block).toBeInTheDocument();
  expect(within(block).getByText(LOAD_FAILED_TITLE)).toBeInTheDocument();
  expect(within(block).getByTestId(`${testId}-cause`)).toHaveTextContent(CAUSE);
}

const EMPTY_FIELDS: ObjectFieldOption[] = [];
const EMPTY_VIEWS: ObjectViewOption[] = [];
const EMPTY_ACTIONS: ObjectActionOption[] = [];

describe('ref:object — a failed object list is not "no objects detected"', () => {
  it('a COMPLETED, empty list still says so (the measurement survives)', () => {
    renderWidget('ref:object', { objectNames: loaded([]) });
    expect(screen.getByPlaceholderText(NO_OBJECTS)).toBeInTheDocument();
    expect(screen.queryByTestId('ref-object-load-failed')).toBeNull();
  });

  it('a FAILED list renders the shared failure block and claims nothing', () => {
    renderWidget('ref:object', { objectNames: failed(CAUSE) });
    expectSharedFailure('ref-object-load-failed');
    // The sentence that would be false is not on screen.
    expect(screen.queryByPlaceholderText(NO_OBJECTS)).toBeNull();
    // …and authoring is not blocked: the freeform input survives.
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('the LOADING arm asserts neither', () => {
    renderWidget('ref:object', { objectNames: { status: 'loading' } });
    expect(screen.queryByTestId('ref-object-load-failed')).toBeNull();
    expect(screen.queryByPlaceholderText(NO_OBJECTS)).toBeNull();
  });

  it('an UNWIRED catalog is idle, not a failure', () => {
    renderWidget('ref:object', {});
    expect(screen.queryByTestId('ref-object-load-failed')).toBeNull();
  });
});

describe('object-selector — a failed object list is not an empty dropdown', () => {
  const spec = { fieldSpec: { field: 'objectName', multiple: true } };

  it('a COMPLETED, empty list still renders the picker', () => {
    renderWidget('object-selector', { objectNames: loaded([]) }, spec);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('object-selector-load-failed')).toBeNull();
  });

  it('a FAILED list replaces the picker with the shared failure block', () => {
    renderWidget('object-selector', { objectNames: failed(CAUSE) }, spec);
    expectSharedFailure('object-selector-load-failed');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('a FAILED list still lets the author edit what is already stored', () => {
    const onChange = vi.fn();
    renderWidget('object-selector', { objectNames: failed(CAUSE) }, {
      ...spec,
      value: ['showcase_account'],
      onChange,
    });
    expect(screen.getByText('showcase_account')).toBeInTheDocument();
    screen.getByRole('button', { name: '×' }).click();
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('field-ref — a failed field catalog is not an object without fields', () => {
  it('a COMPLETED, empty catalog still renders the picker', () => {
    renderWidget('field-ref', { objectFields: loaded(EMPTY_FIELDS) });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('field-ref-load-failed')).toBeNull();
  });

  it('a FAILED catalog replaces the picker with the shared failure block', () => {
    renderWidget('field-ref', { objectFields: failed(CAUSE) });
    expectSharedFailure('field-ref-load-failed');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('view-ref — a failed view catalog is not an object without views', () => {
  it('a COMPLETED, empty catalog still renders the picker', () => {
    renderWidget('view-ref', { objectViews: loaded(EMPTY_VIEWS) });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('view-ref-load-failed')).toBeNull();
  });

  it('a FAILED catalog replaces the picker with the shared failure block', () => {
    renderWidget('view-ref', { objectViews: failed(CAUSE) });
    expectSharedFailure('view-ref-load-failed');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('field-multi — a failed field catalog is not an empty add-list', () => {
  it('a COMPLETED, empty catalog renders the add picker and no failure', () => {
    renderWidget('field-multi', { objectFields: loaded(EMPTY_FIELDS) }, { value: [] });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByTestId('field-multi-load-failed')).toBeNull();
  });

  it('a FAILED catalog renders the shared failure block above the picker', () => {
    renderWidget('field-multi', { objectFields: failed(CAUSE) }, { value: [] });
    expectSharedFailure('field-multi-load-failed');
  });

  it('a FAILED catalog leaves already-chosen fields visible and reorderable', () => {
    renderWidget('field-multi', { objectFields: failed(CAUSE) }, { value: ['status', 'owner'] });
    // Each chip prints the label AND the machine name, so the name is on screen
    // twice by design — assert the chip's controls instead of a bare text match.
    expect(screen.getByLabelText('Remove status')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove owner')).toBeInTheDocument();
  });
});

describe('action-multi — the action catalog carries its OWN fault', () => {
  it('a COMPLETED, empty catalog renders the add picker and no failure', () => {
    renderWidget('action-multi', { objectActions: loaded(EMPTY_ACTIONS) }, { value: [] });
    expect(screen.getByTestId('action-multi')).toBeInTheDocument();
    expect(screen.queryByTestId('action-multi-load-failed')).toBeNull();
  });

  it('a FAILED catalog renders the shared failure block', () => {
    renderWidget('action-multi', { objectActions: failed(CAUSE) }, { value: [] });
    expectSharedFailure('action-multi-load-failed');
  });

  /**
   * The old boundary made this picker read `catalogErrors.fields` to learn
   * whether the ACTION catalog had failed, because the two ride one request.
   * They still do — `ResourceEditPage` derives both from one `LoadState` — but
   * the pairing is now the producer's job to state, and this picker reads only
   * its own arm. Pinned so a field fault can no longer post a banner over a
   * perfectly good action list by accident of key naming.
   */
  it('a failed FIELD catalog does not put a failure on the ACTION picker', () => {
    renderWidget(
      'action-multi',
      { objectFields: failed(CAUSE), objectActions: loaded([{ name: 'approve' }]) },
      { value: [] },
    );
    expect(screen.queryByTestId('action-multi-load-failed')).toBeNull();
  });
});

describe('filter-mode — a failed field catalog is not "bind a source object"', () => {
  /** The empty-state sentence, which NAMES A CAUSE that is false on a failure. */
  const BIND_SOURCE = 'Bind a source object to pick filter fields.';

  it('a COMPLETED, empty catalog still shows the empty-state sentence', () => {
    renderWidget('filter-mode', { objectFields: loaded(EMPTY_FIELDS) }, {
      value: { element: 'dropdown' },
      schema: { type: 'object' },
    });
    expect(screen.getByText(BIND_SOURCE)).toBeInTheDocument();
    expect(screen.queryByTestId('filter-mode-fields-load-failed')).toBeNull();
  });

  it('a FAILED catalog replaces that sentence with the shared failure block', () => {
    renderWidget('filter-mode', { objectFields: failed(CAUSE) }, {
      value: { element: 'dropdown' },
      schema: { type: 'object' },
    });
    expectSharedFailure('filter-mode-fields-load-failed');
    expect(screen.queryByText(BIND_SOURCE)).toBeNull();
  });
});

describe('filter-builder — a failed field catalog is not "no conditions to add"', () => {
  const BIND_SOURCE = 'Bind a source object to add filter conditions.';

  it('a COMPLETED, empty catalog still shows the empty-state sentence', () => {
    renderWidget('filter-builder', { objectFields: loaded(EMPTY_FIELDS) }, {
      value: undefined,
      schema: { type: 'array' },
    });
    expect(screen.getByText(BIND_SOURCE)).toBeInTheDocument();
    expect(screen.queryByTestId('filter-builder-load-failed')).toBeNull();
  });

  it('a FAILED catalog replaces that sentence with the shared failure block', () => {
    renderWidget('filter-builder', { objectFields: failed(CAUSE) }, {
      value: undefined,
      schema: { type: 'array' },
    });
    expectSharedFailure('filter-builder-load-failed');
    expect(screen.queryByText(BIND_SOURCE)).toBeNull();
  });
});
