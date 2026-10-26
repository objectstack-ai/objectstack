// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10847 — the dashboard designer's selected-widget strip and a widget
 * title authored as a per-locale map.
 *
 * `DashboardWidget.title` is the spec's `I18nLabel`: a string, or an inline
 * per-locale map. The strip used to render the stored value as a React child,
 * so selecting a widget titled `{ 'en-US': 'Revenue', 'zh-CN': '收入' }` threw
 * "Objects are not valid as a React child" and the whole preview fell to the
 * error boundary. Its inline rename also wrote one plain string back over the
 * map, which would have dropped every other locale.
 *
 * The ruling on the card: the strip shows the title resolved in the designer
 * locale, the rename draft is seeded from that string, and saving a map title
 * replaces only that locale's entry. A plain-string title stays a string.
 *
 * Pinned through the REAL `DashboardPreview` and the REAL `DashboardRenderer`:
 * the widget is selected by clicking its cell on the canvas, the way an author
 * does it, and the host's selection and draft are held in state so the strip
 * re-renders from what the rename wrote.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// Module-scope import of the lazily loaded renderer, so the preview's
// `React.lazy` factory resolves at once instead of racing the test's wait
// window (AGENTS.md, flaky-test discipline).
import '@object-ui/plugin-dashboard';

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { DashboardPreview } from './DashboardPreview';
import type { MetadataSelection } from '../preview-registry';

afterEach(cleanup);

type Patch = Record<string, unknown>;

const MAP_TITLE = { 'en-US': 'Revenue', 'zh-CN': '收入' };

/** A host that keeps the draft and the selection, as the designer page does. */
function Harness({
  title,
  locale,
  onPatchSpy,
  onSelectionSpy,
}: {
  title: unknown;
  locale: string;
  onPatchSpy: (patch: Patch) => void;
  onSelectionSpy?: (sel: MetadataSelection | null) => void;
}) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'sales_dashboard',
    label: 'Sales',
    widgets: [{ id: 'rev', type: 'metric', title }],
  });
  const [selection, setSelection] = React.useState<MetadataSelection | null>(null);
  return (
    <DashboardPreview
      type="dashboard"
      name="sales_dashboard"
      draft={draft}
      editing
      selection={selection}
      onSelectionChange={(sel) => {
        onSelectionSpy?.(sel);
        setSelection(sel);
      }}
      onPatch={(patch) => {
        onPatchSpy(patch as Patch);
        setDraft((d) => ({ ...d, ...(patch as Patch) }));
      }}
      locale={locale}
    />
  );
}

/** Click the widget's cell on the canvas, then wait for the strip to mount. */
async function selectWidget(clickToRename: string) {
  const cell = await screen.findByTestId('dashboard-preview-widget-rev');
  fireEvent.click(cell);
  return waitFor(() => screen.getByTitle(clickToRename));
}

/** The title the last patch stored on the one widget. */
function storedTitle(onPatchSpy: ReturnType<typeof vi.fn>): unknown {
  const last = onPatchSpy.mock.calls.at(-1)?.[0] as { widgets: Array<{ title: unknown }> };
  return last.widgets[0].title;
}

async function renameTo(titleButton: HTMLElement, next: string) {
  fireEvent.click(titleButton);
  const input = await waitFor(() => screen.getByRole('textbox'));
  const seeded = (input as HTMLInputElement).value;
  fireEvent.change(input, { target: { value: next } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return seeded;
}

describe('DashboardPreview selected-widget strip — a per-locale title map (objectui#10847)', () => {
  it('selects a map-titled widget without crashing and shows the designer-locale title', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<Harness title={MAP_TITLE} locale="zh-CN" onPatchSpy={vi.fn()} />);
      const titleButton = await selectWidget('点击重命名');
      expect(titleButton).toHaveTextContent('收入');
      expect(screen.queryByText('Preview failed to render')).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('renaming a map title replaces only the designer locale entry and keeps the other locale', async () => {
    const onPatchSpy = vi.fn();
    const onSelectionSpy = vi.fn();
    render(
      <Harness title={MAP_TITLE} locale="zh-CN" onPatchSpy={onPatchSpy} onSelectionSpy={onSelectionSpy} />,
    );
    const titleButton = await selectWidget('点击重命名');
    const seeded = await renameTo(titleButton, '营收');

    // The draft is seeded from the resolved string, never `[object Object]`.
    expect(seeded).toBe('收入');
    expect(onPatchSpy).toHaveBeenCalledTimes(1);
    expect(storedTitle(onPatchSpy)).toEqual({ 'en-US': 'Revenue', 'zh-CN': '营收' });
    expect(onSelectionSpy.mock.calls.at(-1)?.[0]).toEqual({ kind: 'widget', id: 'rev', label: '营收' });
    await waitFor(() => expect(screen.getByTitle('点击重命名')).toHaveTextContent('营收'));
  });

  it('a map without the designer locale shows its fallback entry, and a rename adds the locale instead of overwriting it', async () => {
    const onPatchSpy = vi.fn();
    render(<Harness title={{ 'en-US': 'Revenue' }} locale="zh-CN" onPatchSpy={onPatchSpy} />);
    const titleButton = await selectWidget('点击重命名');
    expect(titleButton).toHaveTextContent('Revenue');

    await renameTo(titleButton, '收入');
    expect(storedTitle(onPatchSpy)).toEqual({ 'en-US': 'Revenue', 'zh-CN': '收入' });
  });

  it('control: a plain-string title shows as written and a rename stores a plain string', async () => {
    const onPatchSpy = vi.fn();
    render(<Harness title="Revenue" locale="en-US" onPatchSpy={onPatchSpy} />);
    const titleButton = await selectWidget('Click to rename');
    expect(titleButton).toHaveTextContent('Revenue');

    const seeded = await renameTo(titleButton, 'Sales');
    expect(seeded).toBe('Revenue');
    expect(storedTitle(onPatchSpy)).toBe('Sales');
  });
});
