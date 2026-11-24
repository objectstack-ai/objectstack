// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36167 — `ConditionBuilder` on a LIST subject (a `multiselect` /
 * `checkboxes` / `tags`, or a `select` / `lookup` / `user` declared
 * `multiple: true`).
 *
 * Under `@objectstack/formula`'s `celEngine`, `S == V` compares the whole list
 * with one value, so it answers a constant. The builder therefore offers a
 * list subject what the shared filter builder offers it (membership and the
 * empty checks), writes membership in the one spelling the flow edge's rows
 * write (`cel-list-membership.ts`), and opens a stored `==` on a list in the
 * raw editor unchanged. Every emitted condition is evaluated by the engine
 * beside its spelling, and a single-value field keeps `==`.
 */

// The builder reaches a dynamic `import()` of each module below: its first load
// is paid here, at collection, never inside a case's clocked window
// (`check:test-source-alias`).
import '@objectstack/lint';
import '@object-ui/core';
import * as React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { celEngine } from '@objectstack/formula';
import { jsonColumnFilterOperators } from '@object-ui/components';

// ConditionBuilder calls useObjectFields(objectName) even when `fields` is
// supplied; stub the shared client so the mount-time fetch stays off the network.
const state = vi.hoisted(() => ({
  metadataClient: {
    get: vi.fn(async (): Promise<unknown> => undefined),
    list: vi.fn(async () => [] as unknown[]),
    withPreviewDrafts() { return this; },
  },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder } from './ConditionBuilder';
import { listSubjectOperators } from './cel-list-membership';
import { rowsToCel } from './flow-edge-condition-rows';

afterEach(() => cleanup());

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

type CatalogRow = { name: string; label?: string; type?: string; multiple?: boolean };

const FIELDS: CatalogRow[] = [
  { name: 'labels', label: 'Labels', type: 'multiselect' },
  { name: 'tags', label: 'Tags', type: 'tags' },
  { name: 'channels', label: 'Channels', type: 'checkboxes' },
  { name: 'regions', label: 'Regions', type: 'select', multiple: true },
  { name: 'watchers', label: 'Watchers', type: 'lookup', multiple: true },
  { name: 'reviewers', label: 'Reviewers', type: 'user', multiple: true },
  { name: 'status', label: 'Status', type: 'select' },
  { name: 'owner', label: 'Owner', type: 'lookup' },
  { name: 'address', label: 'Address', type: 'address' },
];
const LIST_FIELDS = FIELDS.slice(0, 6);
const SCALAR_FIELDS = FIELDS.slice(6);

/** The words the builder shows for the shared builder's list operators. */
const LIST_OP_WORDS: Record<string, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

function Harness({ initial }: { initial: string }) {
  const [v, setV] = React.useState(initial);
  return (
    <div>
      <ConditionBuilder label="Condition" value={v} onCommit={setV} fields={FIELDS} />
      <pre data-testid="committed">{v}</pre>
    </div>
  );
}

const committed = () => screen.getByTestId('committed').textContent ?? '';
const comboboxes = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="combobox"]')) as HTMLElement[];
const lastOpTrigger = (c: HTMLElement) => comboboxes(c).at(-1)!;
const rawEditor = (c: HTMLElement) => c.querySelector('textarea');

async function offeredOps(c: HTMLElement): Promise<string[]> {
  await userEvent.click(lastOpTrigger(c));
  const ops = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
  await userEvent.keyboard('{Escape}');
  return ops;
}

async function pickOp(c: HTMLElement, label: string) {
  await userEvent.click(lastOpTrigger(c));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

/** Add a row and pick `field` as its subject. */
async function addRowOn(c: HTMLElement, field: CatalogRow) {
  fireEvent.click(screen.getByText('Add condition'));
  const subjects = comboboxes(c);
  await userEvent.click(subjects[subjects.length - 2]);
  await userEvent.click(await screen.findByRole('option', { name: `${field.label} record.${field.name}` }));
}

const typeValue = (c: HTMLElement, value: string) => {
  const boxes = c.querySelectorAll('input');
  fireEvent.change(boxes[boxes.length - 1], { target: { value } });
};

const evaluate = (cel: string, record: Record<string, unknown>) => {
  const r = celEngine.evaluate({ dialect: 'cel', source: cel }, { record });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

describe('a list subject is offered the shared builder’s list operators, and nothing else', () => {
  it.each(LIST_FIELDS)('$label ($type) offers membership and the empty checks — never == / != / ordering', async (field) => {
    const shared = jsonColumnFilterOperators({ type: field.type, multiple: field.multiple === true })!;
    expect(listSubjectOperators(field)).toEqual(shared);
    const { container } = render(<Harness initial="" />);
    await addRowOn(container, field);
    expect(await offeredOps(container)).toEqual(shared.map((op) => LIST_OP_WORDS[op]));
  });

  it.each(SCALAR_FIELDS)('CONTROL — $label ($type) keeps equals / not equals and is offered no membership', async (field) => {
    expect(listSubjectOperators(field)).toBeUndefined();
    const { container } = render(<Harness initial="" />);
    await addRowOn(container, field);
    const ops = await offeredOps(container);
    expect(ops).toEqual(expect.arrayContaining(['equals', 'not equals', 'is empty', 'is not empty']));
    expect(ops).not.toContain('contains');
    expect(ops).not.toContain('does not contain');
  });
});

describe('membership is written null-safe, in the flow edge’s spelling, and the engine answers it as membership', () => {
  it('picking a list subject moves a new row off `equals` onto `contains`', async () => {
    const { container } = render(<Harness initial="" />);
    await addRowOn(container, FIELDS[0]);
    expect(lastOpTrigger(container).textContent).toBe('contains');
    typeValue(container, 'frontend');
    expect(committed()).toBe("record.labels != null && 'frontend' in record.labels");
  });

  it.each(LIST_FIELDS)('$label: contains / does not contain', async (field) => {
    const s = `record.${field.name}`;
    const { container } = render(<Harness initial="" />);
    await addRowOn(container, field);
    typeValue(container, 'u1');
    const contains = committed();
    await pickOp(container, 'does not contain');
    const notContains = committed();

    expect(contains).toBe(`${s} != null && 'u1' in ${s}`);
    expect(notContains).toBe(`${s} == null || !('u1' in ${s})`);
    // The same row through the flow edge's writer: one spelling.
    const edgeField = { value: s, label: field.label!, type: field.type, multiple: field.multiple };
    expect(rowsToCel({ logic: 'and', conditions: [{ field: s, operator: 'contains', value: 'u1' }] }, [edgeField]))
      .toEqual({ ok: true, cel: contains });
    expect(rowsToCel({ logic: 'and', conditions: [{ field: s, operator: 'not_contains', value: 'u1' }] }, [edgeField]))
      .toEqual({ ok: true, cel: notContains });

    expect(evaluate(contains, { [field.name]: ['u1', 'u2'] })).toBe(true);
    expect(evaluate(contains, { [field.name]: ['u2'] })).toBe(false);
    expect(evaluate(contains, { [field.name]: [] })).toBe(false);
    expect(evaluate(contains, { [field.name]: null })).toBe(false);
    expect(evaluate(notContains, { [field.name]: ['u2'] })).toBe(true);
    expect(evaluate(notContains, { [field.name]: ['u1', 'u2'] })).toBe(false);
    expect(evaluate(notContains, { [field.name]: [] })).toBe(true);
    expect(evaluate(notContains, { [field.name]: null })).toBe(true);
  });

  it('the empty checks on a list keep their null-or-empty-list spelling', async () => {
    const { container } = render(<Harness initial="" />);
    await addRowOn(container, FIELDS[0]);
    await pickOp(container, 'is empty');
    const cel = committed();
    expect(cel).toBe('record.labels == null || size(record.labels) == 0');
    expect(evaluate(cel, { labels: [] })).toBe(true);
    expect(evaluate(cel, { labels: null })).toBe(true);
    expect(evaluate(cel, { labels: ['qa'] })).toBe(false);
  });

  it('INSTRUMENT CONTROL — the equality this replaces answers a constant on a list', () => {
    expect(evaluate("record.labels == 'frontend'", { labels: ['frontend', 'qa'] })).toBe(false);
    expect(evaluate("record.labels == 'frontend'", { labels: ['qa'] })).toBe(false);
    expect(evaluate("record.labels != 'frontend'", { labels: ['frontend', 'qa'] })).toBe(true);
    expect(evaluate("record.labels != 'frontend'", { labels: ['qa'] })).toBe(true);
  });
});

describe('a stored condition on a list reads back exactly, or opens in the raw editor unchanged', () => {
  it.each([
    ['contains, alone', "record.labels != null && 'frontend' in record.labels"],
    ['does not contain, alone', "record.labels == null || !('frontend' in record.labels)"],
    ['contains, joined', "record.status == 'done' && (record.watchers != null && 'u1' in record.watchers)"],
  ])('%s: reopens as rows, and an edit re-emits it unchanged', (_name, cel) => {
    const { container } = render(<Harness initial={cel} />);
    expect(rawEditor(container), 'opened in the raw editor — it did not round-trip').toBeNull();
    if (cel.startsWith("record.status == 'done'")) {
      fireEvent.change(container.querySelector('input')!, { target: { value: 'closed' } });
      expect(committed()).toBe(cel.replace("'done'", "'closed'"));
    }
  });

  it.each([
    ['== on a list', "record.labels == 'frontend'"],
    ['!= on a list, joined', "record.status == 'done' && record.regions != 'emea'"],
    ['membership on a single-value field', "record.owner != null && 'u1' in record.owner"],
  ])('%s: opens in the raw editor verbatim, and nothing is emitted', (_name, stored) => {
    const { container } = render(<Harness initial={stored} />);
    expect(rawEditor(container), 'expected the raw CEL editor').not.toBeNull();
    expect(rawEditor(container)!.value).toBe(stored);
    expect(committed()).toBe(stored);
  });

  it('CONTROL — equality on a single-value field still opens as rows', () => {
    const { container } = render(<Harness initial="record.status == 'done'" />);
    expect(rawEditor(container)).toBeNull();
    expect(lastOpTrigger(container).textContent).toBe('equals');
  });
});

describe('moving a row between a list and a single-value field keeps an offered operator', () => {
  it('list → single value: membership becomes equals, the value kept', async () => {
    const { container } = render(<Harness initial="record.labels != null && 'frontend' in record.labels" />);
    await userEvent.click(comboboxes(container)[0]);
    await userEvent.click(await screen.findByRole('option', { name: 'Status record.status' }));
    expect(lastOpTrigger(container).textContent).toBe('equals');
    expect(committed()).toBe("record.status == 'frontend'");
  });

  it('an empty check survives the move, re-spelled for the new field', async () => {
    const { container } = render(<Harness initial="record.labels == null || size(record.labels) == 0" />);
    await userEvent.click(comboboxes(container)[0]);
    await userEvent.click(await screen.findByRole('option', { name: 'Owner record.owner' }));
    expect(lastOpTrigger(container).textContent).toBe('is empty');
    expect(committed()).toBe('record.owner == null');
  });
});
