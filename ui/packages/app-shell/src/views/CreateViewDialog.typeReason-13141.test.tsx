// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13141: a Create View type card that cannot be chosen says WHY on
 * its face, and a card that can be chosen shows its description in full.
 *
 * ## The defect this pins
 *
 * On an object with only text / date / picklist fields, the Gallery, Map and
 * Chart cards read "Not supported by this object." and nothing else. The
 * reason ("This object has no field that can serve as ...") sat only in a
 * `title` on the disabled button: a disabled button takes no focus, touch has
 * no hover, and the accessible description was empty, so keyboard, touch and
 * screen-reader users never reached it. Descriptions of the selectable types
 * were clamped to two lines in a four-column grid and cut mid-word.
 *
 * ## What the pins assert
 *
 * Rendered under a real English `I18nProvider`, so the field-specific
 * sentence is the one a user reads, interpolation included. A blocked card's
 * reason is visible text and is the card's accessible description; a
 * selectable card's description carries no `line-clamp-*` and its full text is
 * present; and the control: selection still works on an available card and
 * still does nothing on a blocked one.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { CreateViewDialog } from './CreateViewDialog';

afterEach(cleanup);

/**
 * An object with only text / date / picklist fields. Its `name` is empty, so
 * no dataset catalog is fetched and the chart card is blocked on its dataset
 * without a network.
 */
const TASK = {
  name: '',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    due_date: { type: 'date', label: 'Due date' },
    status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
  },
};

const GALLERY_REASON = 'This object has no field that can serve as "Image field".';
const DATASET_REASON = 'This object exposes no dataset to chart.';
const KANBAN_DESC = 'Cards grouped into columns by a single-select field.';
const SHORT = 'Not supported by this object.';

async function openDialog() {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <CreateViewDialog open onOpenChange={() => {}} onCreate={vi.fn()} objectDef={TASK} />
    </I18nProvider>,
  );
  // The English bundle is in once a label resolves to its English text.
  await screen.findByText(KANBAN_DESC);
}

const card = (type: string) => screen.getByTestId(`create-view-type-${type}`) as HTMLButtonElement;
const cardText = (type: string) => screen.getByTestId(`create-view-type-${type}-text`);

describe('a blocked view type says why on its face (objectui#13141)', () => {
  it('shows the field-specific reason on the Gallery card, as its accessible description', async () => {
    await openDialog();
    const gallery = card('gallery');
    expect(gallery.disabled).toBe(true);
    expect(cardText('gallery')).toHaveTextContent(GALLERY_REASON);
    expect(gallery).toHaveAccessibleDescription(GALLERY_REASON);
    expect(gallery).toHaveAccessibleName('Gallery');
    expect(gallery).not.toHaveTextContent(SHORT);
  });

  it('shows the dataset reason on a dataset-blocked Chart card the same way', async () => {
    await openDialog();
    const chart = card('chart');
    expect(chart.disabled).toBe(true);
    expect(cardText('chart')).toHaveTextContent(DATASET_REASON);
    expect(chart).toHaveAccessibleDescription(DATASET_REASON);
    expect(chart).not.toHaveTextContent(SHORT);
  });
});

describe('a selectable view type shows its description in full (objectui#13141)', () => {
  it('carries no line-clamp on the description, and the whole sentence is present', async () => {
    await openDialog();
    const text = cardText('kanban');
    expect(text.className).not.toMatch(/line-clamp-/);
    expect(text.textContent).toBe(KANBAN_DESC);
    expect(card('kanban')).toHaveAccessibleDescription(KANBAN_DESC);
  });
});

describe('control: selection is unchanged (objectui#13141)', () => {
  it('selects an available type on click, and a blocked one stays unselectable', async () => {
    await openDialog();
    expect(card('kanban').disabled).toBe(false);
    fireEvent.click(card('kanban'));
    await waitFor(() => expect(card('kanban')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(card('gallery'));
    expect(card('gallery')).toHaveAttribute('aria-pressed', 'false');
    expect(card('kanban')).toHaveAttribute('aria-pressed', 'true');
  });
});
