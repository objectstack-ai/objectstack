/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Two failed validation rules on one save are said as two entries
 * (objectstack-ai/objectstack#28053).
 *
 * The server keeps one `fields[]` entry per failed rule — on the field the rule
 * names, else on `_record` — and joins only the top-level message with `; `.
 * The banner and the toast used to show that joined text, so two broken rules
 * read as one run-on sentence. Each rule now gets its own line, except the ones
 * already written under an input.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toast } from '../../../ui/sonner';
// Registers the renderers at module scope, NOT inside a `beforeAll` — see
// object-ui/no-dynamic-import-in-test-hook.
import '../../../renderers';

let toastErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'id' as any);
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The body `POST /data/:object` answers, as `@objectstack/client` decorates it. */
function ruleRefusal(fields: Array<{ field: string; message: string }>) {
  const message = fields.map((f) => f.message).join('; ');
  const wire = fields.map((f) => ({ ...f, code: 'rule_violation' }));
  return Object.assign(new Error(message), {
    code: 'VALIDATION_FAILED',
    httpStatus: 400,
    details: { error: message, code: 'VALIDATION_FAILED', fields: wire, object: 'forecast' },
  });
}

function renderForm(onSubmit: (data: any) => Promise<unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        fields: [
          { name: 'amount', label: 'Amount', type: 'input' },
          { name: 'best', label: 'Best case', type: 'input' },
        ],
        onSubmit,
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

/** The banner's text lines: its list items, or its one string. */
function bannerLines(container: HTMLElement): string[] {
  const banner = container.querySelector('[role="alert"]') as HTMLElement;
  const items = within(banner).queryAllByRole('listitem');
  return items.length > 0 ? items.map((li) => li.textContent ?? '') : [banner.textContent ?? ''];
}

/** The toast's content, drawn, as text lines. */
function toastLines(): string[] {
  const content = toastErrorSpy.mock.calls.at(-1)![0] as React.ReactNode;
  if (typeof content === 'string') return [content];
  const { container } = render(<>{content}</>);
  return Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '');
}

const AMOUNT = 'Amount must be positive.';
const NAME = 'Name is required for a forecast.';
const BEST = 'Best case must be at least the amount.';

describe('form renderer — one entry per failed validation rule (#28053)', () => {
  it('two record-level rules: two banner lines and two toast lines, no joined summary', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      ruleRefusal([{ field: '_record', message: AMOUNT }, { field: '_record', message: NAME }]),
    );
    const { container } = renderForm(onSubmit);

    submit();

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(bannerLines(container)).toEqual([AMOUNT, NAME]);
    expect(toastLines()).toEqual([AMOUNT, NAME]);
    expect(container.textContent).not.toContain('; ');
  });

  it('one located + one record-level rule: the inline mark, and one banner line for the other', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      ruleRefusal([{ field: 'best', message: BEST }, { field: '_record', message: AMOUNT }]),
    );
    const { container } = renderForm(onSubmit);
    const bestWrap = container.querySelector('[data-field="best"]') as HTMLElement;

    submit();

    await waitFor(() => expect(bestWrap.textContent).toContain(BEST));
    expect(bestWrap.querySelector('[aria-invalid="true"]')).toBeTruthy();
    expect(bannerLines(container)).toEqual([AMOUNT]);
    expect(toastLines()).toEqual([AMOUNT]);
  });

  it('a single record-level rule is unchanged: its message, once', async () => {
    const onSubmit = vi.fn().mockRejectedValue(ruleRefusal([{ field: '_record', message: AMOUNT }]));
    const { container } = renderForm(onSubmit);

    submit();

    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalled());
    expect(toastErrorSpy.mock.calls[0][0]).toBe(AMOUNT);
    expect(bannerLines(container)).toEqual([AMOUNT]);
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
  });
});
