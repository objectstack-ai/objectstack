// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A public form's `thank-you` panel fills its `{{record.field_name}}` tokens
 * from the submit answer's `fields` (`PublicFormSubmitResponseSchema`): a
 * web-to-case visitor sees their case number, never the token's own text. A
 * name the answer carries no value for fills as empty, and a value is drawn as
 * text, never as markup.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage, fillThankYouPanel, readThankYouAnswerFields } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** The public `/forms/:slug` resolver payload, with a `thank-you` panel. */
function publicPayload(panel: { title?: string; message?: string }) {
  return {
    slug: 'report-issue',
    object: 'support_case',
    label: 'Report an issue',
    form: {
      type: 'simple',
      sections: [{ fields: ['subject'] }],
      submitBehavior: { kind: 'thank-you', ...panel },
    },
    objectSchema: {
      name: 'support_case',
      fields: {
        subject: { type: 'text', label: 'Subject' },
        case_number: { type: 'autonumber', label: 'Case number' },
      },
    },
  };
}

function stubFetch(payload: unknown, answer: unknown) {
  return vi.fn(async (url: string) => {
    const body = String(url).includes('/forms/report-issue/submit') ? answer : payload;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

async function submitPublic(panel: { title?: string; message?: string }, answer: unknown) {
  vi.stubGlobal('fetch', stubFetch(publicPayload(panel), answer));
  const view = render(
    <MemoryRouter initialEntries={['/f/report-issue']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText(/Subject/);
  await userEvent.type(screen.getByLabelText(/Subject/), 'Printer jams');
  await userEvent.click(screen.getByRole('button', { name: /Submit/ }));
  return view;
}

beforeEach(() => {
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public thank-you panel — record field tokens', () => {
  it('shows the answer\'s value for a `{{record.case_number}}` token in the message and the title', async () => {
    await submitPublic(
      { title: 'Case {{record.case_number}} opened', message: 'Your case number is {{record.case_number}}.' },
      { id: 'case-1', fields: { case_number: 'CASE-0042' } },
    );

    expect(await screen.findByText('Your case number is CASE-0042.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Case CASE-0042 opened' })).toBeInTheDocument();
  });

  it('fills a token the answer carries no value for as empty, never as the token text', async () => {
    const { container } = await submitPublic(
      { message: 'Your case number is {{record.case_number}}.' },
      { id: 'case-1' },
    );

    expect(await screen.findByText('Your case number is .')).toBeInTheDocument();
    expect(container.textContent).not.toContain('{{');
  });

  it('draws a value as text, never as markup', async () => {
    const value = '<img src="x" alt="injected"><b>bold</b>';
    const { container } = await submitPublic(
      { message: 'Case: {{record.case_number}}' },
      { id: 'case-1', fields: { case_number: value } },
    );

    expect(await screen.findByText(`Case: ${value}`)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('reads the answer through the spec\'s shape: an answer with keys beyond `id` and `fields` fills nothing', async () => {
    await submitPublic(
      { message: 'Your case number is {{record.case_number}}.' },
      { id: 'case-1', fields: { case_number: 'CASE-0042' }, record: { case_number: 'CASE-0042' } },
    );

    await waitFor(() => expect(screen.getByText('Your case number is .')).toBeInTheDocument());
  });
});

describe('fillThankYouPanel', () => {
  it('never reads a filled value for tokens again', () => {
    const filled = fillThankYouPanel(
      { message: '{{record.case_number}} / {{record.ref_code}}' },
      { case_number: '{{record.ref_code}}', ref_code: 'R-7' },
    );
    expect(filled.message).toBe('{{record.ref_code}} / R-7');
  });

  it('fills a name that is an Object.prototype key as empty', () => {
    expect(fillThankYouPanel({ message: 'x{{record.constructor}}y' }, {}).message).toBe('xy');
  });

  it('leaves a panel with no token as authored', () => {
    const panel = { title: 'Thanks', message: 'We got it.' };
    expect(fillThankYouPanel(panel, { case_number: 'CASE-1' })).toEqual(panel);
  });
});

describe('readThankYouAnswerFields', () => {
  it('reads `fields` off the public submit answer', () => {
    expect(readThankYouAnswerFields({ id: 'a', fields: { case_number: 7 } })).toEqual({ case_number: 7 });
  });

  it('reads none off an answer that is not the public submit shape', () => {
    expect(readThankYouAnswerFields({ object: 'x', id: 'a', record: { case_number: 7 } })).toBeUndefined();
    expect(readThankYouAnswerFields(undefined)).toBeUndefined();
  });
});
