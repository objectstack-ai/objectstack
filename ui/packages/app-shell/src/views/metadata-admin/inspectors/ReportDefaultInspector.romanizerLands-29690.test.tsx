// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29690 — a designer's Name in create mode, when the pinyin
 * dictionary lands after a Chinese Label was typed.
 *
 * The dictionary is a lazy chunk, so the Label `收入金额` typed first leaves the
 * Name empty. When the chunk lands, the empty Name takes `shouru_jine` without
 * another keystroke (`useWhenRomanizerLands`, shared by the object, report and
 * dataset designers). It lands once: a person who then clears the Name to type
 * their own is not refilled with the pinyin.
 *
 * This file never loads the dictionary up front, so the module-wide state is
 * "not loaded" when the case starts.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import { romanizerPending } from '../romanizeHan';

afterEach(cleanup);

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

function CreateHost() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({ type: 'summary' });
  return (
    <ReportDefaultInspector
      type="report"
      name=""
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      readOnly={false}
      locale="en-US"
      datasetCatalogOverride={[]}
    />
  );
}

const nameBox = () => screen.getByLabelText('Name', { exact: true }) as HTMLInputElement;
const labelBox = () => screen.getByLabelText('Label', { exact: true }) as HTMLInputElement;

describe('report designer — the Name fills when the pinyin dictionary lands (objectstack#29690)', () => {
  it('empty while loading, shouru_jine once landed, and a cleared Name is not refilled', async () => {
    render(<CreateHost />);
    fireEvent.change(labelBox(), { target: { value: '收入金额' } });
    expect(romanizerPending('收入金额')).toBe(true);
    expect(nameBox()).toHaveValue('');
    await waitFor(() => expect(nameBox()).toHaveValue('shouru_jine'), { timeout: 8000 });
    fireEvent.change(nameBox(), { target: { value: '' } });
    expect(nameBox()).toHaveValue('');
    fireEvent.change(nameBox(), { target: { value: 'revenue_amount' } });
    expect(nameBox()).toHaveValue('revenue_amount');
  });
});
