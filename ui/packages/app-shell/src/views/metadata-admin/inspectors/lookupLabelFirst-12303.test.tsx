// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12303 row 6 — the lookup rail reads label first, machine name second.
 *
 * Measured on the card: the Lookup field's "Picker config › Display field"
 * listed each option as its api name first, in the body font, with the label
 * muted and truncated after it (`email_ver…  Email V…`), and "Related object"
 * showed the bare `sys_user`. Expected: the label primary and the api name
 * secondary (smaller, monospace), the form the Studio object header and the
 * permission matrix already use.
 *
 * The two pickers are the shared ones the rail mounts — `InspectorComboField`
 * (Display field) and `ObjectPicker` (Related object) — rendered as the rail
 * renders them. Each case has its control: an option, or a value, with no
 * label of its own still shows the machine name alone, in monospace.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => {
  const CATALOG: Array<Record<string, unknown>> = [
    { name: 'sys_user', label: 'User', isSystem: true, _packageId: 'com.objectstack.plugin-auth' },
    { name: 'showcase_account', label: 'Account', isSystem: false, _packageId: 'com.example.showcase' },
  ];
  const previewList = vi.fn(async (_type: string) => CATALOG);
  const client = { withPreviewDrafts: vi.fn((_on: boolean) => ({ list: previewList })) };
  return { client };
});

vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { InspectorComboField } from './InspectorComboField';
import { ObjectPicker } from './ObjectPicker';

afterEach(cleanup);

/** The Display field's options as `LookupConfigFields` builds them: label, value, type hint. */
const FIELD_OPTIONS = [
  { value: 'email_verified', label: 'Email Verified', hint: 'boolean' },
  { value: 'name', label: 'Name', hint: 'text' },
  // An option with no label of its own (a value the caller names only by itself).
  { value: 'legacy_code', label: 'legacy_code' },
];

/** The text spans of an option row, in DOM order, without the type hint. */
function rowTexts(option: HTMLElement): HTMLElement[] {
  return Array.from(option.querySelectorAll('span')).filter((s) => !s.className.includes('ml-auto')) as HTMLElement[];
}

describe('Display field (InspectorComboField) — label first, api name second (objectui#12303)', () => {
  function renderCombo(value = '') {
    render(
      <InspectorComboField
        label="Display field"
        value={value}
        onCommit={() => {}}
        options={FIELD_OPTIONS}
        mono
      />,
    );
    return screen.getByRole('combobox', { name: 'Display field' });
  }

  it('each labelled option leads with its label; the api name follows, smaller and monospace', async () => {
    const user = userEvent.setup();
    await user.click(renderCombo());
    const option = await screen.findByRole('option', { name: /Email Verified/ });

    const [primary, secondary] = rowTexts(option);
    expect(primary).toHaveTextContent(/^Email Verified$/);
    expect(primary).not.toHaveClass('font-mono');
    expect(secondary).toHaveTextContent(/^email_verified$/);
    expect(secondary).toHaveClass('font-mono');
    expect(secondary).toHaveClass('text-muted-foreground');
    // The label comes first in what is read, too.
    expect(option.textContent!.indexOf('Email Verified')).toBeLessThan(option.textContent!.indexOf('email_verified'));
  });

  it('the trigger shows a chosen option by its label, in the body font even when the caller asks for `mono`', () => {
    const trigger = renderCombo('email_verified');
    const text = trigger.querySelector('span') as HTMLElement;
    expect(text).toHaveTextContent(/^Email Verified$/);
    expect(text).not.toHaveClass('font-mono');
  });

  it('CONTROL — an option whose label is its value shows the value alone, in monospace, as before', async () => {
    const user = userEvent.setup();
    await user.click(renderCombo());
    const option = await screen.findByRole('option', { name: /legacy_code/ });
    const texts = rowTexts(option);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toHaveTextContent(/^legacy_code$/);
    expect(texts[0]).toHaveClass('font-mono');
  });

  it('CONTROL — a raw value no option names still shows as itself, in the caller’s monospace', () => {
    const trigger = renderCombo('formula_path');
    expect(trigger).toHaveTextContent(/^formula_path$/);
    expect(trigger.querySelector('span')).toHaveClass('font-mono');
  });
});

describe('Related object (ObjectPicker) — at rest it reads as the label (objectui#12303)', () => {
  function renderPicker(value: string) {
    render(
      <MemoryRouter>
        <ObjectPicker label="Related object" value={value} onCommit={() => {}} />
      </MemoryRouter>,
    );
    return screen.getByRole('combobox', { name: 'Related object' });
  }
  const describedBy = (el: HTMLElement) => {
    const id = el.getAttribute('aria-describedby');
    return id ? document.getElementById(id) : null;
  };

  it('a committed name the catalog knows shows its label, with the api name as the secondary line it is described by', async () => {
    const input = renderPicker('sys_user');
    await waitFor(() => expect(input).toHaveValue('User'));
    expect(input).not.toHaveClass('font-mono');
    const nameLine = describedBy(input);
    expect(nameLine).toHaveTextContent(/^sys_user$/);
    expect(nameLine).toHaveClass('font-mono');
  });

  it('focus puts the api name back in the input to edit', async () => {
    const user = userEvent.setup();
    const input = renderPicker('sys_user');
    await waitFor(() => expect(input).toHaveValue('User'));
    await user.click(input);
    expect(input).toHaveValue('sys_user');
    expect(input).toHaveClass('font-mono');
  });

  it('CONTROL — a value the catalog does not know shows as itself, in monospace, with no secondary line', async () => {
    const input = renderPicker('{{trigger.object}}');
    // Wait for the catalog read to land, so the control is read after it.
    await waitFor(() => expect(h.client.withPreviewDrafts).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(input).toHaveValue('{{trigger.object}}');
    expect(input).toHaveClass('font-mono');
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});
