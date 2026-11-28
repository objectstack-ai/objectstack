/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36608 — a lazily loaded field widget whose first chunk load
 * fails (a deploy that replaced the chunk, a dropped connection) must not keep
 * that failure until the page is reloaded. Every lazy site of this package goes
 * through `recoverableLazy`; the first block pins the helper, the rest pin each
 * site: a failed first load reaches the error boundary, and a later mount
 * renders the widget once the chunk is reachable.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// Paid at collection, not inside a test's clock: the registry pin imports it
// again after `vi.resetModules` (check:test-source-alias).
import '@object-ui/core';

afterEach(() => cleanup());

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <div data-testid="load-failed" /> : this.props.children;
  }
}

/** Lets pending promises and timers settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function Loaded(): React.ReactElement {
  return <div data-testid="widget-loaded" />;
}

describe('recoverableLazy', () => {
  async function load() {
    vi.resetModules();
    return (await import('../recoverableLazy')).recoverableLazy;
  }

  function tree(Widget: React.ComponentType<object>) {
    return (
      <Boundary>
        <React.Suspense fallback={<div data-testid="host-fallback" />}>
          <Widget />
        </React.Suspense>
      </Boundary>
    );
  }

  it('suspends to the host fallback while loading, and a later mount renders in the same pass', async () => {
    const recoverableLazy = await load();
    const loader = vi.fn(async () => ({ default: Loaded }));
    const Widget = recoverableLazy(loader);

    const first = render(tree(Widget));
    expect(screen.getByTestId('host-fallback')).toBeTruthy();
    await screen.findByTestId('widget-loaded');
    first.unmount();

    render(tree(Widget));
    expect(screen.getByTestId('widget-loaded')).toBeTruthy();
    // `load()` hands over the widget itself, through the same request.
    expect(await Widget.load()).toBe(Loaded);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('mounts that ask while the chunk loads share one request', async () => {
    const recoverableLazy = await load();
    const loader = vi.fn(async () => ({ default: Loaded }));
    const Widget = recoverableLazy(loader);

    render(
      <React.Suspense fallback={null}>
        <Widget />
        <Widget />
      </React.Suspense>,
    );
    await waitFor(() => expect(screen.getAllByTestId('widget-loaded')).toHaveLength(2));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('a failed load reaches the error boundary once, without asking again, and the next mount loads', async () => {
    const recoverableLazy = await load();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const loader = vi
        .fn<() => Promise<{ default: React.ComponentType<object> }>>()
        .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
        .mockResolvedValue({ default: Loaded });
      const Widget = recoverableLazy(loader);

      const first = render(tree(Widget));
      await screen.findByTestId('load-failed');
      // The failure is shown, not retried in a loop behind the loading face.
      await settle();
      expect(loader).toHaveBeenCalledTimes(1);
      first.unmount();

      render(tree(Widget));
      await screen.findByTestId('widget-loaded');
      expect(screen.queryByTestId('load-failed')).toBeNull();
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      quiet.mockRestore();
    }
  });

  it('holds under StrictMode: one request per failure, and the next mount loads', async () => {
    const recoverableLazy = await load();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const loader = vi
        .fn<() => Promise<{ default: React.ComponentType<object> }>>()
        .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
        .mockResolvedValue({ default: Loaded });
      const Widget = recoverableLazy(loader);

      const first = render(<React.StrictMode>{tree(Widget)}</React.StrictMode>);
      await screen.findByTestId('load-failed');
      await settle();
      expect(loader).toHaveBeenCalledTimes(1);
      first.unmount();

      render(<React.StrictMode>{tree(Widget)}</React.StrictMode>);
      await screen.findByTestId('widget-loaded');
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      quiet.mockRestore();
    }
  });
});

/**
 * Fail the next load of `chunk` (a path relative to this file) once, then
 * answer `loaded`. Restored by the returned call.
 */
function failTheNextLoadOf(chunk: string, loaded: Record<string, unknown>): () => void {
  vi.resetModules();
  let failNextLoad = true;
  vi.doMock(chunk, () => {
    if (failNextLoad) {
      failNextLoad = false;
      throw new Error(`Failed to fetch dynamically imported module: ${chunk}`);
    }
    return loaded;
  });
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => {
    quiet.mockRestore();
    vi.doUnmock(chunk);
  };
}

/** Mounts `draw()` under a boundary: first the failure, then — on a later mount — the widget. */
async function expectFailedThenRecovered(draw: () => React.ReactElement, afterMount?: () => void): Promise<void> {
  const first = render(<Boundary><React.Suspense fallback={null}>{draw()}</React.Suspense></Boundary>);
  afterMount?.();
  await screen.findByTestId('load-failed');
  first.unmount();

  render(<Boundary><React.Suspense fallback={null}>{draw()}</React.Suspense></Boundary>);
  afterMount?.();
  await screen.findByTestId('widget-loaded');
  expect(screen.queryByTestId('load-failed')).toBeNull();
}

describe('each lazy field-widget site recovers after one failed chunk load', () => {
  it('FieldEditWidget: the date picker', async () => {
    const restore = failTheNextLoadOf('../widgets/date-picker/DatePickerField', {
      DatePickerField: Loaded,
      DateTimePickerField: Loaded,
    });
    try {
      const { FieldEditWidget } = await import('../FieldEditWidget');
      await expectFailedThenRecovered(() => (
        <FieldEditWidget field={{ name: 'due', type: 'date' } as never} value="2026-10-16" onChange={() => {}} />
      ));
    } finally {
      restore();
    }
  });

  it('FieldEditWidget: the datetime picker', async () => {
    const restore = failTheNextLoadOf('../widgets/date-picker/DatePickerField', {
      DatePickerField: Loaded,
      DateTimePickerField: Loaded,
    });
    try {
      const { FieldEditWidget } = await import('../FieldEditWidget');
      await expectFailedThenRecovered(() => (
        <FieldEditWidget field={{ name: 'at', type: 'datetime' } as never} value="" onChange={() => {}} />
      ));
    } finally {
      restore();
    }
  });

  it("FieldEditWidget: the rich text editor in the cell's panel", async () => {
    const restore = failTheNextLoadOf('../widgets/RichTextField', { RichTextField: Loaded });
    try {
      const { FieldEditWidget } = await import('../FieldEditWidget');
      await expectFailedThenRecovered(() => (
        <FieldEditWidget field={{ name: 'notes', type: 'markdown' } as never} value="**x**" onChange={() => {}} inCell />
      ));
    } finally {
      restore();
    }
  });

  it('the markdown read face (richTextDisplay)', async () => {
    const restore = failTheNextLoadOf('../widgets/MarkdownContent', { default: Loaded });
    try {
      const { RICH_TEXT_CELL_RENDERERS } = await import('../widgets/richTextDisplay');
      const Markdown = RICH_TEXT_CELL_RENDERERS.markdown;
      await expectFailedThenRecovered(() => (
        <Markdown value="**bold**" field={{ name: 'notes', type: 'markdown' } as never} />
      ));
    } finally {
      restore();
    }
  });

  it('FilterConditionCell', async () => {
    const restore = failTheNextLoadOf('../widgets/FilterConditionField', { FilterConditionField: Loaded });
    try {
      const { FilterConditionCell } = await import('../widgets/FilterConditionCell');
      await expectFailedThenRecovered(() => (
        <FilterConditionCell
          value='{"field":"priority","operator":"eq","value":"urgent"}'
          field={{ name: 'criteria', type: 'textarea', widget: 'filter-condition' } as never}
        />
      ));
    } finally {
      restore();
    }
  });

  it("the image field's crop dialog", async () => {
    const restore = failTheNextLoadOf('../widgets/ImageCropperDialog', { ImageCropperDialog: Loaded });
    try {
      const { ImageField } = await import('../widgets/ImageField');
      const cover = { name: 'cover.png', url: 'https://cdn.example/cover.png', mime_type: 'image/png' };
      await expectFailedThenRecovered(
        () => <ImageField field={{ name: 'p_cover', crop: true } as never} value={cover} onChange={() => {}} />,
        () => fireEvent.click(screen.getByTestId('image-field-crop-0')),
      );
    } finally {
      restore();
    }
  });

  it('getLazyFieldWidget', async () => {
    const restore = failTheNextLoadOf('../widgets/date-picker/DatePickerField', {
      DatePickerField: Loaded,
      DateTimePickerField: Loaded,
    });
    try {
      const { getLazyFieldWidget } = await import('../index');
      const DateWidget = getLazyFieldWidget('date');
      await expectFailedThenRecovered(() => (
        <DateWidget field={{ name: 'due', type: 'date' }} value="2026-10-16" onChange={() => {}} />
      ));
    } finally {
      restore();
    }
  });

  it('registerField (the form registry)', async () => {
    const restore = failTheNextLoadOf('../widgets/date-picker/DatePickerField', {
      DatePickerField: Loaded,
      DateTimePickerField: Loaded,
    });
    try {
      const { registerField } = await import('../index');
      const { ComponentRegistry } = await import('@object-ui/core');
      registerField('date');
      const Registered = ComponentRegistry.get('date', 'field') as React.ComponentType<Record<string, unknown>>;
      expect(Registered).toBeTruthy();
      await expectFailedThenRecovered(() => (
        <Registered schema={{ name: 'due', type: 'date' }} value="2026-10-16" onChange={() => {}} />
      ));
    } finally {
      restore();
    }
  });
});
