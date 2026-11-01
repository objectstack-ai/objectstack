// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27948 (ruling A, step 2) — an action's copy slots are `template`
 * slots, so a parsed definition carries `{ dialect: 'template', source }`
 * where it carried a string: `confirmText` / `successMessage` since #24814,
 * a param's `helpText` (and `description`, an `outcomeMessages` entry) now.
 *
 * The preview drew a param's `helpText` raw — an envelope as a React child,
 * the #31 crash — and read `confirmText` / `successMessage` as an `I18nLabel`
 * map, which shows the word "template". It reads the envelope's `source`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ActionPreview } from '../ActionPreview';

afterEach(cleanup);

const envelope = (source: string) => ({ dialect: 'template', source });

function renderDraft(copy: (s: string) => unknown) {
  return render(
    <ActionPreview
      type="action"
      name="pause_account"
      draft={{
        name: 'pause_account',
        label: 'Pause',
        type: 'script',
        target: 'pauseAccount',
        locations: ['record_header'],
        confirmText: copy('Pause {{ record.name }}?'),
        successMessage: copy('Paused {{ record.name }}'),
        params: [{ name: 'reason', label: 'Reason', type: 'text', helpText: copy('Why {{ record.name }} is paused') }],
      }}
    />,
  );
}

describe('ActionPreview reads the template envelope on action copy (objectstack#27948)', () => {
  it('draws each envelope\'s source, never the word "template"', () => {
    renderDraft(envelope);
    expect(screen.getAllByText('Why {{ record.name }} is paused').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pause {{ record.name }}?').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Paused {{ record.name }}').length).toBeGreaterThan(0);
    expect(screen.queryByText('template')).toBeNull();
  });

  it('CONTROL: the bare strings draw the same text', () => {
    renderDraft((s) => s);
    expect(screen.getAllByText('Why {{ record.name }} is paused').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pause {{ record.name }}?').length).toBeGreaterThan(0);
  });
});
