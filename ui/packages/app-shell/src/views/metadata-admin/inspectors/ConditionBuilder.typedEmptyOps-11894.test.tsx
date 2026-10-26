// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConditionBuilder's two value-less operators are TYPED by the field catalog
 * (objectui#11894).
 *
 * The defect, as the Studio benchmark measured it: a validation rule built as
 * `record.status` *equals* `done` AND `record.due_date` *is false / empty*
 * saved as `record.status == 'done' && !record.due_date`. CEL's `!` takes a
 * bool, so every matching write was refused with `no such overload: !null`
 * (no due date) or `!string` (with one).
 *
 * The verdicts here are read off the CEL the builder EMITS, evaluated with the
 * engine the server evaluates a validation rule with — `@objectstack/formula`'s
 * `ExpressionEngine.evaluate`, called with `{ record, previous }`, the binding
 * objectql's `checkPredicate` hands it — so a pin goes red if the emission is
 * ill typed, not only if its spelling moves.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpressionEngine } from '@objectstack/formula';

// objectui#4697 — ConditionBuilder calls useObjectFields(objectName)
// unconditionally even when `fields` is supplied, so stub the shared client to
// keep the mount-time fetch off the network. The fetched-catalog case below
// answers it.
const state = vi.hoisted(() => ({
  metadataClient: {
    get: vi.fn(async (): Promise<unknown> => undefined),
    list: vi.fn(async () => [] as unknown[]),
    // `useObjectFields` reads the draft-overlaid object (objectui#11895).
    withPreviewDrafts() { return this; },
  },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder } from './ConditionBuilder';

afterEach(() => {
  cleanup();
  state.metadataClient.get.mockReset();
  state.metadataClient.get.mockImplementation(async () => undefined);
});

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

/** A catalog that types every field, the way the hook-, action-, page-block-,
 *  flow- and schema-form mounts hand it over. */
const TYPED_FIELDS = [
  { name: 'status', label: 'Status', type: 'select' },
  { name: 'due_date', label: 'Due date', type: 'date' },
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'tags', label: 'Tags', type: 'tags' },
  { name: 'owner', label: 'Owner', type: 'lookup' },
  { name: 'watchers', label: 'Watchers', type: 'lookup', multiple: true },
  { name: 'flag', label: 'Flag', type: 'boolean' },
  { name: 'score', label: 'Score', type: 'formula' },
];

/** The same catalog with no types — what a mount that carries none passes. */
const UNTYPED_FIELDS = TYPED_FIELDS.map(({ name, label }) => ({ name, label }));

/** Evaluate `source` exactly as objectql's validation-rule evaluator does. */
function evaluate(source: string, record: Record<string, unknown>): { ok: true; value: unknown } | { ok: false; error: string } {
  const res = ExpressionEngine.evaluate<boolean>({ dialect: 'cel', source }, { record, previous: undefined });
  return res.ok ? { ok: true, value: res.value } : { ok: false, error: String(res.error?.message ?? res.error) };
}

type CatalogRow = { name: string; label?: string; type?: string; multiple?: boolean };

function Harness({ initial, fields }: { initial: string; fields: ReadonlyArray<CatalogRow> }) {
  const [v, setV] = React.useState(initial);
  return (
    <div>
      <ConditionBuilder label="Condition" value={v} onCommit={setV} fields={fields} />
      <pre data-testid="committed">{v}</pre>
    </div>
  );
}

const committed = () => screen.getByTestId('committed').textContent ?? '';
const comboboxes = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="combobox"]')) as HTMLElement[];
/** The LAST row's operator trigger: its controls are subject, operator. */
const lastOpTrigger = (c: HTMLElement) => comboboxes(c).at(-1)!;

/** Open the last row's operator dropdown and read the operators it offers. */
async function offeredOps(c: HTMLElement): Promise<string[]> {
  await userEvent.click(lastOpTrigger(c));
  return (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
}

/** Pick `label` from the last row's operator dropdown. */
async function pickOp(c: HTMLElement, label: string) {
  await userEvent.click(lastOpTrigger(c));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

/** A two-row builder whose second row names `subject`, ready for an operator. */
function mountBenchmark(subject: string, fields: ReadonlyArray<CatalogRow> = TYPED_FIELDS) {
  return render(<Harness initial={`record.status == 'done' && ${subject} == 'x'`} fields={fields} />);
}

describe('the benchmark rule on a DATE field evaluates both ways (objectui#11894)', () => {
  it('"is empty" compiles to a null check, true with no due date and false with one', async () => {
    const { container } = mountBenchmark('record.due_date');
    await pickOp(container, 'is empty');
    const cel = committed();
    expect(cel).toBe("record.status == 'done' && record.due_date == null");
    expect(evaluate(cel, { status: 'done', due_date: null })).toEqual({ ok: true, value: true });
    expect(evaluate(cel, { status: 'done', due_date: '2026-10-20' })).toEqual({ ok: true, value: false });
  });

  it('"is not empty" is the exact complement', async () => {
    const { container } = mountBenchmark('record.due_date');
    await pickOp(container, 'is not empty');
    const cel = committed();
    expect(cel).toBe("record.status == 'done' && record.due_date != null");
    expect(evaluate(cel, { status: 'done', due_date: null })).toEqual({ ok: true, value: false });
    expect(evaluate(cel, { status: 'done', due_date: '2026-10-20' })).toEqual({ ok: true, value: true });
  });

  it('INSTRUMENT CONTROL — the emission this replaces faults in the same engine, both ways', () => {
    // If this ever evaluated, the evaluator above would not be the one that
    // refused the benchmark's writes, and the two pins above would prove less.
    const old = "record.status == 'done' && !record.due_date";
    expect(evaluate(old, { status: 'done', due_date: null })).toMatchObject({ ok: false, error: expect.stringContaining('no such overload') });
    expect(evaluate(old, { status: 'done', due_date: '2026-10-20' })).toMatchObject({ ok: false, error: expect.stringContaining('no such overload') });
  });
});

describe('a TEXT field: "is empty" is null or the empty string', () => {
  it('compiles to a parenthesised null-or-empty check that is true for null and for \'\'', async () => {
    const { container } = mountBenchmark('record.title');
    await pickOp(container, 'is empty');
    const cel = committed();
    expect(cel).toBe("record.status == 'done' && (record.title == null || record.title == '')");
    expect(evaluate(cel, { status: 'done', title: null })).toEqual({ ok: true, value: true });
    expect(evaluate(cel, { status: 'done', title: '' })).toEqual({ ok: true, value: true });
    expect(evaluate(cel, { status: 'done', title: 'Leaky tap' })).toEqual({ ok: true, value: false });
  });

  it('"is not empty" is the complement', async () => {
    const { container } = mountBenchmark('record.title');
    await pickOp(container, 'is not empty');
    const cel = committed();
    expect(cel).toBe("record.status == 'done' && (record.title != null && record.title != '')");
    expect(evaluate(cel, { status: 'done', title: null })).toEqual({ ok: true, value: false });
    expect(evaluate(cel, { status: 'done', title: '' })).toEqual({ ok: true, value: false });
    expect(evaluate(cel, { status: 'done', title: 'Leaky tap' })).toEqual({ ok: true, value: true });
  });
});

describe('a MULTI-VALUE field: "is empty" is null or the empty list', () => {
  it('`tags`: true for null and for [], false for a member', async () => {
    const { container } = mountBenchmark('record.tags');
    await pickOp(container, 'is empty');
    const cel = committed();
    expect(cel).toBe("record.status == 'done' && (record.tags == null || size(record.tags) == 0)");
    expect(evaluate(cel, { status: 'done', tags: null })).toEqual({ ok: true, value: true });
    expect(evaluate(cel, { status: 'done', tags: [] })).toEqual({ ok: true, value: true });
    expect(evaluate(cel, { status: 'done', tags: ['urgent'] })).toEqual({ ok: true, value: false });
  });

  it('a lookup is multi-value only when declared `multiple: true` — the spec reads both keys', async () => {
    const multi = mountBenchmark('record.watchers');
    await pickOp(multi.container, 'is not empty');
    const multiCel = committed();
    expect(multiCel).toBe("record.status == 'done' && (record.watchers != null && size(record.watchers) != 0)");
    expect(evaluate(multiCel, { status: 'done', watchers: [] })).toEqual({ ok: true, value: false });
    expect(evaluate(multiCel, { status: 'done', watchers: ['u1'] })).toEqual({ ok: true, value: true });
    cleanup();

    const single = mountBenchmark('record.owner');
    await pickOp(single.container, 'is not empty');
    expect(committed()).toBe("record.status == 'done' && record.owner != null");
  });
});

describe('CONTROL — a boolean field compiles as it always did', () => {
  it('is worded "is true" / "is false" and emits the bare subject and its negation', async () => {
    const { container } = mountBenchmark('record.flag');
    const ops = await offeredOps(container);
    expect(ops).toEqual(expect.arrayContaining(['is true', 'is false']));
    expect(ops).not.toContain('is empty');
    await userEvent.click(screen.getByRole('option', { name: 'is false' }));
    const cel = committed();
    expect(cel).toBe("record.status == 'done' && !record.flag");
    expect(evaluate(cel, { status: 'done', flag: false })).toEqual({ ok: true, value: true });

    await pickOp(container, 'is true');
    expect(committed()).toBe("record.status == 'done' && record.flag");
  });
});

describe('an UNDECLARED subject keeps the form and the words it had', () => {
  it('a field the catalog carries no type for: "is empty / false" still emits `!S`', async () => {
    const { container } = mountBenchmark('record.due_date', UNTYPED_FIELDS);
    const ops = await offeredOps(container);
    expect(ops).toEqual(expect.arrayContaining(['is set / true', 'is empty / false']));
    await userEvent.click(screen.getByRole('option', { name: 'is empty / false' }));
    expect(committed()).toBe("record.status == 'done' && !record.due_date");
  });

  it('a `formula` is undeclared — its value takes a `returnType` no catalog row carries', async () => {
    const { container } = mountBenchmark('record.score');
    await pickOp(container, 'is set / true');
    expect(committed()).toBe("record.status == 'done' && record.score");
  });
});

describe('the operator list follows the field type', () => {
  it('a declared non-boolean field offers "is empty" / "is not empty", not the boolean or untyped words', async () => {
    const { container } = mountBenchmark('record.due_date');
    const ops = await offeredOps(container);
    expect(ops).toEqual(expect.arrayContaining(['equals', 'not equals', 'is not empty', 'is empty']));
    for (const gone of ['is true', 'is false', 'is set / true', 'is empty / false']) expect(ops).not.toContain(gone);
  });
});

describe('a round trip through parse is lossless', () => {
  const cases: Array<[string, string]> = [
    ['date, is empty', "record.status == 'done' && record.due_date == null"],
    ['date, is not empty', "record.status == 'done' || record.due_date != null"],
    ['text, is empty, joined', "record.status == 'done' && (record.title == null || record.title == '')"],
    ['text, is not empty, joined', "record.status == 'done' || (record.title != null && record.title != '')"],
    ['text, is empty, alone', "record.title == null || record.title == ''"],
    ['multi-value, is empty, joined', "record.status == 'done' && (record.tags == null || size(record.tags) == 0)"],
    ['multi-value, is not empty, alone', 'record.tags != null && size(record.tags) != 0'],
    ['boolean, is false', "record.status == 'done' && !record.flag"],
  ];
  for (const [name, cel] of cases) {
    it(`${name}: reopens as rows, and an edit to another row re-emits the check unchanged`, () => {
      const { container } = render(<Harness initial={cel} fields={TYPED_FIELDS} />);
      expect(container.querySelector('textarea'), 'opened in the raw editor — it did not round-trip').toBeNull();
      expect(screen.getAllByText(cel).length).toBeGreaterThanOrEqual(1);
      // Every row is recompiled on any edit, so editing the `status` row's
      // value proves the check row compiles back to its own text.
      const valueBox = container.querySelector('input') as HTMLInputElement | null;
      if (cel.startsWith("record.status == 'done'")) {
        fireEvent.change(valueBox!, { target: { value: 'closed' } });
        expect(committed()).toBe(cel.replace("'done'", "'closed'"));
      }
    });
  }

  it('a lone text check reads back as ONE "is empty" row, not two comparisons', async () => {
    const { container } = render(<Harness initial="record.title == null || record.title == ''" fields={TYPED_FIELDS} />);
    expect(screen.getAllByLabelText('Remove condition')).toHaveLength(1);
    expect(lastOpTrigger(container).textContent).toBe('is empty');
  });

  it('a removed sibling leaves the check unparenthesised, and still well typed', () => {
    render(<Harness initial="record.status == 'done' && (record.title == null || record.title == '')" fields={TYPED_FIELDS} />);
    fireEvent.click(screen.getAllByLabelText('Remove condition')[0]);
    const cel = committed();
    expect(cel).toBe("record.title == null || record.title == ''");
    expect(evaluate(cel, { title: '' })).toEqual({ ok: true, value: true });
  });
});

describe('a stored `!field` on a non-boolean field is never silently rewritten', () => {
  it('opens in the raw editor verbatim (it no longer round-trips), and nothing is emitted', () => {
    const stored = "record.status == 'done' && !record.due_date";
    const { container } = render(<Harness initial={stored} fields={TYPED_FIELDS} />);
    const ta = container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(ta, 'expected the raw CEL editor').not.toBeNull();
    expect(ta!.value).toBe(stored);
    expect(committed()).toBe(stored);
  });

  it('CONTROL — the same text on an untyped catalog still opens as rows', () => {
    const stored = "record.status == 'done' && !record.due_date";
    const { container } = render(<Harness initial={stored} fields={UNTYPED_FIELDS} />);
    expect(container.querySelector('textarea')).toBeNull();
  });
});

describe('a new row starts on a typed operator, not `truthy`', () => {
  it('"Add condition" seeds `equals`; picking a subject emits a well-typed comparison', async () => {
    const { container } = render(<Harness initial="" fields={TYPED_FIELDS} />);
    fireEvent.click(screen.getByText('Add condition'));
    expect(lastOpTrigger(container).textContent).toBe('equals');
    await userEvent.click(comboboxes(container)[0]);
    await userEvent.click(await screen.findByRole('option', { name: 'record.due_date' }));
    const cel = committed();
    expect(cel).toBe("record.due_date == ''");
    expect(evaluate(cel, { due_date: null })).toEqual({ ok: true, value: false });
    expect(evaluate(cel, { due_date: '2026-10-20' })).toEqual({ ok: true, value: false });
  });
});

describe('a catalog FETCHED by objectName types the rows once it lands', () => {
  function mountFetched(initial: string) {
    state.metadataClient.get.mockImplementation(async () => ({
      name: 'repair_ticket',
      fields: {
        status: { type: 'select' },
        title: { type: 'text' },
        due_date: { type: 'date' },
      },
    }));
    return render(
      <ConditionBuilder label="Condition" value={initial} onCommit={() => {}} objectName="repair_ticket" />,
    );
  }

  it('a builder-made text check reopens as rows, not in the raw editor', async () => {
    const { container } = mountFetched("record.status == 'done' && (record.title == null || record.title == '')");
    await waitFor(() => expect(container.querySelector('textarea')).toBeNull());
    expect(lastOpTrigger(container).textContent).toBe('is empty');
  });

  it('a stored `!record.due_date` ends in the raw editor, as at a mount handed its fields', async () => {
    const stored = "record.status == 'done' && !record.due_date";
    const { container } = mountFetched(stored);
    await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(stored);
  });
});
