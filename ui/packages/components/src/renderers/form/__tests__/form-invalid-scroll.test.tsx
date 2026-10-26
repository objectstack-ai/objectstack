/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #2793: submitting a form with a missing required field must give visible
 * feedback — scroll the first errored field into view + focus it. Before this,
 * react-hook-form's native focus-on-error silently no-opped for custom widgets
 * (lookup / select / master-detail), so on a long form the user clicked 创建
 * and saw nothing.
 *
 * And NO toast (objectstack#25874). The toast that used to name the fields
 * (#2329) repeated what each field already says under its input, truncated its
 * own list after three names, and was drawn over the record dialog's title. The
 * inline messages carry the detail; focus carries the "something is wrong".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toast } from '../../../ui/sonner';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

let toastErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'id' as any);
  // happy-dom doesn't implement scrollIntoView — install a no-op we can spy on.
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(fields: any[], defaultValues?: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        fields,
        ...(defaultValues ? { defaultValues } : {}),
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

describe('form renderer — invalid-submit feedback (#2793)', () => {
  it('scrolls+focuses the first errored field on a missing required field, with no toast', async () => {
    const { container } = renderForm([
      { name: 'title', label: 'Title', type: 'input', required: true },
      { name: 'project', label: 'Project', type: 'input', required: true },
    ]);

    const titleWrap = container.querySelector('[data-field="title"]') as HTMLElement;
    const scrollSpy = vi.fn();
    titleWrap.scrollIntoView = scrollSpy;

    submit();

    // First errored field (visual order) scrolled into view + focused.
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(titleWrap.contains(document.activeElement)).toBe(true),
    );
    // The per-field message is the only error text: it is under the input…
    expect(titleWrap.textContent).toMatch(/required/i);
    // …and no toast repeats it over the dialog.
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  it('scrolls the first errored field even when an earlier field is valid', async () => {
    const { container } = renderForm(
      [
        { name: 'title', label: 'Title', type: 'input', required: true },
        { name: 'project', label: 'Project', type: 'input', required: true },
      ],
      { title: 'Filled' },
    );

    const titleWrap = container.querySelector('[data-field="title"]') as HTMLElement;
    const projectWrap = container.querySelector('[data-field="project"]') as HTMLElement;
    const titleScroll = vi.fn();
    const projectScroll = vi.fn();
    titleWrap.scrollIntoView = titleScroll;
    projectWrap.scrollIntoView = projectScroll;

    submit();

    // Only `project` is invalid → it, not the valid `title`, is scrolled to.
    await waitFor(() => expect(projectScroll).toHaveBeenCalled());
    expect(titleScroll).not.toHaveBeenCalled();
  });

  it('does not toast or scroll when the form is valid', async () => {
    const { container } = renderForm(
      [{ name: 'title', label: 'Title', type: 'input', required: true }],
      { title: 'Filled' },
    );
    const wrap = container.querySelector('[data-field="title"]') as HTMLElement;
    const scrollSpy = vi.fn();
    wrap.scrollIntoView = scrollSpy;

    submit();

    // Give any async validation a tick, then assert no error feedback fired.
    await new Promise((r) => setTimeout(r, 50));
    expect(toastErrorSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
