// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ObjectDefaultInspector } from './ObjectDefaultInspector';

afterEach(cleanup);

const baseProps = {
  type: 'object',
  onSelectionChange: vi.fn(),
  locale: 'en-US' as const,
};

/**
 * Pick a posture through the shared `Select` (objectui#11865): open the
 * trigger from the keyboard, then click the option whose text starts with
 * `label`.
 */
function pickPosture(label: string): void {
  fireEvent.keyDown(screen.getByTestId('object-access-posture'), { key: 'ArrowDown' });
  const option = within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .find((o) => o.textContent?.startsWith(label));
  if (!option) throw new Error(`the posture picker lists no "${label}" option`);
  fireEvent.click(option);
}

function labelledInput(label: string): HTMLInputElement {
  // The shared field renders <Label>{text}</Label> followed by the input
  // inside the same wrapper div.
  const lab = screen.getByText(label);
  const input = lab.parentElement!.querySelector('input, textarea');
  return input as HTMLInputElement;
}

describe('ObjectDefaultInspector — basics', () => {
  it('renders curated object basics (no raw fields JSON)', () => {
    const { container } = render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account', label: 'Account', pluralLabel: 'Accounts', fields: { a: { type: 'text' } } }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(screen.getByText('Basic info')).toBeInTheDocument();
    expect((labelledInput('Label')).value).toBe('Account');
    expect((labelledInput('Plural label')).value).toBe('Accounts');
    // The fields JSON must NOT leak into this panel.
    expect(container.textContent).not.toContain('object-fields');
    expect(container.querySelector('textarea')).toBeTruthy(); // description only
  });

  it('commits edits via onPatch', () => {
    const onPatch = vi.fn();
    render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account', label: 'Account' }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Plural label'), { target: { value: 'Accounts' } });
    expect(onPatch).toHaveBeenCalledWith({ pluralLabel: 'Accounts' });
    // The Icon field is the icon picker (objectui#12531): pick, don't type.
    fireEvent.click(screen.getByRole('combobox', { name: 'Icon' }));
    fireEvent.change(screen.getByLabelText('Search icons…'), { target: { value: 'building' } });
    fireEvent.click(screen.getAllByRole('option').find((o) => o.getAttribute('title') === 'building')!);
    expect(onPatch).toHaveBeenCalledWith({ icon: 'building' });
  });
});

describe('ObjectDefaultInspector — name editability', () => {
  it('locks the name in edit mode (existing object)', () => {
    render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account', label: 'Account' }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(labelledInput('Name')).toBeDisabled();
  });

  it('allows editing the name in create mode (empty host name)', () => {
    const onPatch = vi.fn();
    render(
      <ObjectDefaultInspector
        {...baseProps}
        name=""
        draft={{ name: '' }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    const nameInput = labelledInput('Name');
    expect(nameInput).not.toBeDisabled();
    fireEvent.change(nameInput, { target: { value: 'My Thing' } });
    expect(onPatch).toHaveBeenCalledWith({ name: 'my_thing' });
  });
});

describe('ObjectDefaultInspector — create-mode name derivation', () => {
  it('auto-derives a snake_case name from the label until name is edited', () => {
    const onPatch = vi.fn();
    // objectui#12680 — whether the name was edited is read off the draft, so
    // the harness applies each patch to the draft the way the host does.
    function Host() {
      const [draft, setDraft] = React.useState<Record<string, unknown>>({ name: '' });
      return (
        <ObjectDefaultInspector
          {...baseProps}
          name=""
          draft={draft}
          onPatch={(patch) => {
            onPatch(patch);
            setDraft((d) => ({ ...d, ...patch }));
          }}
          readOnly={false}
        />
      );
    }
    render(<Host />);
    // Typing a label derives name.
    fireEvent.change(labelledInput('Label'), { target: { value: 'Sales Order' } });
    expect(onPatch).toHaveBeenCalledWith({ label: 'Sales Order', name: 'sales_order' });

    onPatch.mockClear();
    // Once the user edits name, label changes no longer overwrite it.
    fireEvent.change(labelledInput('Name'), { target: { value: 'so' } });
    expect(onPatch).toHaveBeenCalledWith({ name: 'so' });
    onPatch.mockClear();
    fireEvent.change(labelledInput('Label'), { target: { value: 'Sales Orders' } });
    expect(onPatch).toHaveBeenCalledWith({ label: 'Sales Orders' }); // no name key
  });
});

describe('ObjectDefaultInspector — i18n', () => {
  it('renders Chinese labels under zh-CN', () => {
    render(
      <ObjectDefaultInspector
        {...baseProps}
        locale={'zh-CN'}
        name="account"
        draft={{ name: 'account', label: '客户' }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(screen.getByText('基础信息')).toBeInTheDocument();
    expect(screen.getByText('显示名')).toBeInTheDocument();
    expect(screen.getByText('复数显示名')).toBeInTheDocument();
  });
});

describe('ObjectDefaultInspector — read-only', () => {
  it('disables all inputs when readOnly', () => {
    render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account', label: 'Account' }}
        onPatch={vi.fn()}
        readOnly
      />,
    );
    expect(labelledInput('Label')).toBeDisabled();
    expect(labelledInput('Plural label')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Icon' })).toBeDisabled();
  });
});

describe('ObjectDefaultInspector — access section (ADR-0066 D2/D3/④/⑤)', () => {
  it('renders the Access section with the public posture by default', () => {
    render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account', label: 'Account' }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(screen.getByText('Access')).toBeInTheDocument();
    expect(screen.getByTestId('object-access-posture').textContent).toBe('Public — covered by wildcard grants (default)');
  });

  it('patches access.default=private and clears it back to the spec default', () => {
    const onPatch = vi.fn();
    const { rerender } = render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account' }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    pickPosture('Private');
    expect(onPatch).toHaveBeenCalledWith({ access: { default: 'private' } });

    rerender(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account', access: { default: 'private' } }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    expect(screen.getByTestId('object-access-posture').textContent).toBe('Private — needs an explicit grant');
    // The private hint warns that a grant must exist before publishing.
    expect(screen.getByText(/Make sure some permission set grants/i)).toBeInTheDocument();
    pickPosture('Public');
    // public = spec default → the key is cleared, not written out.
    expect(onPatch).toHaveBeenCalledWith({ access: undefined });
  });

  it('edits requiredPermissions as a comma-separated capability list (array form)', () => {
    const onPatch = vi.fn();
    render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account', requiredPermissions: ['manage_billing'] }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    const input = screen.getByTestId('object-reqperms-all') as HTMLInputElement;
    expect(input.value).toBe('manage_billing');
    fireEvent.change(input, { target: { value: 'manage_billing, approve_invoice' } });
    expect(onPatch).toHaveBeenCalledWith({ requiredPermissions: ['manage_billing', 'approve_invoice'] });
    fireEvent.change(input, { target: { value: '' } });
    expect(onPatch).toHaveBeenCalledWith({ requiredPermissions: undefined });
  });

  it('renders per-operation inputs when the draft already uses the map form (⑤)', () => {
    const onPatch = vi.fn();
    render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account', requiredPermissions: { update: ['manage_billing'] } }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    // Map-form drafts always render per-op inputs (mode is derived from the
    // value shape, independent of the spec feature-detect for the toggle).
    const update = screen.getByTestId('object-reqperms-update') as HTMLInputElement;
    expect(update.value).toBe('manage_billing');
    fireEvent.change(screen.getByTestId('object-reqperms-read'), { target: { value: 'view_billing' } });
    expect(onPatch).toHaveBeenCalledWith({
      requiredPermissions: { update: ['manage_billing'], read: ['view_billing'] },
    });
  });

  it('shows the per-operation toggle when the bundled spec exports the ⑤ union', async () => {
    render(
      <ObjectDefaultInspector
        {...baseProps}
        name="account"
        draft={{ name: 'account' }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    // Installed @objectstack/spec (≥ 12.7) exports
    // ObjectRequiredPermissionsSchema, so the feature-detect reveals the mode
    // toggle (progressive enhancement — hidden only when the bundled spec
    // would reject the map shape). The detect is async, so wait for the toggle
    // to appear instead of racing a fixed timeout — a hardcoded 20ms sometimes
    // fired before the detect settled under CI load, yielding a flaky null.
    expect(await screen.findByTestId('object-reqperms-perop')).toBeInTheDocument();
  });
});
