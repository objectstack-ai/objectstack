/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { t } from '../metadata-admin/i18n';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

const baseDraft = {
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'select', label: 'Status' },
  },
};

function renderPanel(draft: Record<string, unknown>, onPatch = vi.fn()) {
  render(
    <ObjectSettingsPanel name="leave_request" draft={draft} onPatch={onPatch} locale="en-US" />,
  );
  return onPatch;
}

/**
 * The OWD dials are the shared `Select` (objectui#11865): its options exist
 * only while it is open, so open it from the keyboard and return its list.
 */
async function openDial(testId: string) {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox'));
}

describe('ObjectSettingsPanel — record sharing (OWD)', () => {
  it('exposes the sharing model control with the four canonical OWD options', async () => {
    renderPanel(baseDraft);
    // The section header is present.
    expect(screen.getByText('Record sharing (OWD)')).toBeTruthy();
    // Canonical OWD options are all offered.
    const internal = await openDial('owd-internal-select');
    expect(internal.getByRole('option', { name: 'Private — owner only' })).toBeTruthy();
    expect(
      internal.getByRole('option', { name: 'Public read — everyone reads, only the owner writes' }),
    ).toBeTruthy();
    expect(
      internal.getByRole('option', { name: 'Public read/write — everyone reads and writes' }),
    ).toBeTruthy();
    expect(
      internal.getByRole('option', { name: 'Controlled by parent — inherited from the master record' }),
    ).toBeTruthy();
  });

  /**
   * REPLACED, not re-spelled (objectui#5418). This case used to assert the
   * panel told the author an unset model "defaults to Private" and left it
   * there — true about the RUNTIME (ADR-0090 D1 fail-closed) and misleading
   * about the only question being asked at this control, which is whether the
   * object can ship. It cannot: the publish door refuses an object that
   * declares no OWD (`security-owd-unset`). The old assertion passed for as
   * long as the console reassured the author about a state that blocked them.
   */
  it('warns that an unset sharing model is REFUSED at publish, not merely defaulted', () => {
    renderPanel(baseDraft);
    const desc = screen.getByTestId('owd-internal-desc');
    expect(desc.textContent).toMatch(/refused/i);
    expect(desc.textContent).toMatch(/security-owd-unset/);
    // The runtime fallback is still stated — it is what makes `private` the
    // safe pick — but as context, not as an all-clear.
    expect(desc.textContent).toMatch(/Private/);
    // Styled as a problem.
    expect(desc.className).toMatch(/amber/);
  });

  it('drops the warning styling once a baseline is authored', () => {
    renderPanel({ ...baseDraft, sharingModel: 'private' });
    const desc = screen.getByTestId('owd-internal-desc');
    expect(desc.className).not.toMatch(/amber/);
    expect(desc.textContent).not.toMatch(/refused/i);
  });

  it('patches sharingModel when a model is picked', async () => {
    const onPatch = renderPanel(baseDraft);
    fireEvent.click((await openDial('owd-internal-select')).getByRole('option', { name: 'Private — owner only' }));
    expect(onPatch).toHaveBeenCalledWith({ sharingModel: 'private' });
  });

  it('clears sharingModel back to unset', async () => {
    const onPatch = renderPanel({ ...baseDraft, sharingModel: 'private' });
    expect(screen.getByTestId('owd-internal-select').textContent).toBe('Private — owner only');
    fireEvent.click(
      (await openDial('owd-internal-select')).getByRole('option', { name: t('engine.studio.settings.sharingUnset', 'en-US') }),
    );
    expect(onPatch).toHaveBeenCalledWith({ sharingModel: undefined });
  });
});

/**
 * objectui#12353 — `externalSharingModel` is retired by `@objectstack/spec`
 * (objectstack#23268, ruling A): an author who sets it is refused with "delete
 * the key". Studio no longer offers the external dial, nor the D11
 * "external wider than internal" warning, and no pick on this panel writes the
 * key — even on an object that still stores it.
 */
describe('ObjectSettingsPanel — no external OWD dial (objectui#12353)', () => {
  it('renders no external dial or D11 warning, and a sharing-model pick patches sharingModel alone', async () => {
    const onPatch = renderPanel({
      ...baseDraft,
      sharingModel: 'public_read',
      externalSharingModel: 'public_read_write',
    });
    expect(screen.queryByTestId('owd-external-select')).toBeNull();
    expect(screen.queryByTestId('owd-external-desc')).toBeNull();
    expect(document.body.textContent).not.toMatch(/externalSharingModel/);
    fireEvent.click((await openDial('owd-internal-select')).getByRole('option', { name: 'Private — owner only' }));
    expect(onPatch.mock.calls).toEqual([[{ sharingModel: 'private' }]]);
  });
});

describe('ObjectSettingsPanel — capabilities (enable.*, framework#2707/#2727)', () => {
  it('renders only the LIVE flags with effective defaults (opt-in unchecked, opt-out checked)', () => {
    renderPanel(baseDraft);
    expect(screen.getByTestId('capabilities-section')).toBeTruthy();
    // Opt-in flags default OFF…
    expect((screen.getByTestId('cap-trackHistory') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('cap-files') as HTMLInputElement).checked).toBe(false);
    // …opt-out flags default ON.
    expect((screen.getByTestId('cap-feeds') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('cap-activities') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('cap-searchable') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('cap-clone') as HTMLInputElement).checked).toBe(true);
    // trash/mru no longer exist in the spec (removed, framework#2377 — a
    // rendered toggle would author a key the strict schema rejects).
    expect(screen.queryByTestId('cap-trash')).toBeNull();
    expect(screen.queryByTestId('cap-mru')).toBeNull();
  });

  it('reflects authored values (explicit false on an opt-out, true on an opt-in)', () => {
    renderPanel({ ...baseDraft, enable: { feeds: false, files: true, searchable: false } });
    expect((screen.getByTestId('cap-feeds') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('cap-files') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('cap-searchable') as HTMLInputElement).checked).toBe(false);
    // Untouched flags keep their effective defaults.
    expect((screen.getByTestId('cap-activities') as HTMLInputElement).checked).toBe(true);
  });

  it('toggling writes an explicit boolean into enable, preserving sibling keys', () => {
    const onPatch = renderPanel({ ...baseDraft, enable: { files: true } });
    fireEvent.click(screen.getByTestId('cap-feeds'));
    expect(onPatch).toHaveBeenCalledWith({ enable: { files: true, feeds: false } });
  });

  it('enabling an opt-in flag patches enable.trackHistory: true', () => {
    const onPatch = renderPanel(baseDraft);
    fireEvent.click(screen.getByTestId('cap-trackHistory'));
    expect(onPatch).toHaveBeenCalledWith({ enable: { trackHistory: true } });
  });
});
