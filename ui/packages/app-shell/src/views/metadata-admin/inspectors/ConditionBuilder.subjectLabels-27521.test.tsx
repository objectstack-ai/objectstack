// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConditionBuilder — a field subject reads by its label (objectstack#27521,
 * Studio row 26).
 *
 * The Validations pillar's "Reject the save when…" listed `record.estimated_hours`
 * under the placeholder "field / context", while the list-view filter in the
 * same product showed labels. A field subject now reads by its label, with the
 * spelling the CEL uses beside it; the compiled CEL is unchanged. A field with
 * no label keeps its spelling, and the context subjects are as before. The
 * label is the mount's choice (`labelSubjects`): a mount that lists spellings
 * keeps them.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder } from './ConditionBuilder';
import { t } from '../i18n';

afterEach(cleanup);

const FIELDS = [
  { name: 'estimated_hours', label: 'Estimated Hours', type: 'number' },
  { name: 'code', type: 'text' },
];

function mount(includePrevious = false, labels = true) {
  const onChange = vi.fn();
  render(
    <ConditionBuilder
      value=""
      onCommit={onChange}
      fields={FIELDS}
      subjects={includePrevious ? { includePrevious: true } : undefined}
      labelSubjects={labels}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t('engine.inspector.condition.add', 'en-US') }));
  return { onChange };
}

async function openSubjects() {
  const trigger = screen.getAllByRole('combobox')[0];
  expect(trigger).toHaveTextContent(t('engine.inspector.condition.subjectPlaceholder', 'en-US'));
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

describe('ConditionBuilder · field subjects read by label (objectstack#27521)', () => {
  it('a labelled field reads by its label with its spelling beside it; an unlabelled one by its spelling', async () => {
    mount();
    const options = await openSubjects();
    const texts = options.map((o) => o.textContent);
    expect(texts).toContain('Estimated Hoursrecord.estimated_hours');
    expect(texts).toContain('record.code');
    // The context subjects are unchanged.
    expect(texts).toContain('user.id');
  });

  it('picking the labelled field still compiles to its CEL spelling', async () => {
    const { onChange } = mount();
    const options = await openSubjects();
    fireEvent.click(options.find((o) => o.textContent?.startsWith('Estimated Hours'))!);
    fireEvent.change(screen.getByPlaceholderText(t('engine.inspector.condition.valuePlaceholder', 'en-US')), {
      target: { value: '40' },
    });
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).toContain('record.estimated_hours');
  });

  it('a previous-value subject names the field and that it is the value before the change', async () => {
    mount(true);
    const texts = (await openSubjects()).map((o) => o.textContent);
    expect(texts).toContain('Estimated Hours (before the change)previous.estimated_hours');
  });

  it('CONTROL — a mount that does not ask for labels lists the spellings', async () => {
    mount(false, false);
    const texts = (await openSubjects()).map((o) => o.textContent);
    expect(texts).toContain('record.estimated_hours');
    expect(texts.some((x) => x?.includes('Estimated Hours'))).toBe(false);
  });
});
