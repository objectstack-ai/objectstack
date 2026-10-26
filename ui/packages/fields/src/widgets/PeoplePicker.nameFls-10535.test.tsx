/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * PeoplePicker's rows and selection tray name a person from the fields the
 * viewer may read — objectui#10535.
 *
 * Under the renderer-side FLS rulings (objectui#7215 / objectui#7230)
 * field-level security gates the OUTPUT. objectui#10433 gated the subtitle and
 * the avatar a person row and the tray draw; the NAME was still read straight
 * off the served row (`getPersonName`: the display field, then `name`,
 * `username`, `label`), so on a backend that does not strip denied keys
 * (ObjectStack's `FieldMasker` does) a denied name printed in the row, in the
 * tray chip, and in the avatar's `alt` and the chip's remove label.
 *
 * The denied-name fallback is the one the lookup editor's option label already
 * has (objectui#10411): a denied rung is skipped and the ladder falls through
 * to the next readable source, exactly as it does for the row a stripping
 * backend serves. So every denial pin below also compares the gated picker with
 * an ungated one fed the stripped row, and the two must read the same.
 *
 * What is pinned, against the real `PermissionProvider` (not a stub), on the
 * object the picker queries (`sys_user`):
 *
 *  - a denied name is not drawn in the row or the tray; the next readable
 *    source stands in, and the row can still be chosen;
 *  - the configured display field is the rung judged first, not a literal
 *    `name`;
 *  - with every name source denied, the row and the tray read as they do for
 *    a stripping backend's row;
 *  - a policy that changes after mount relabels the SAME mounted row and chip;
 *  - lit controls: a name the policy does NOT deny still prints, and with no
 *    policy loaded (no provider: `isLoaded` is false) the row is named as
 *    served — so the pins above read a GATE, not a name that went missing.
 *
 * `LoadedImage` reports every image as loaded, so Radix's `AvatarImage` renders
 * its `img` — whose `alt` is the drawn name, which the HTML assertions read.
 */

import * as React from 'react';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionProvider } from '@object-ui/permissions';
import type { DataSource, ObjectPermissionConfig } from '@object-ui/types';
import { PeoplePicker } from './PeoplePicker';

const AMY = {
  id: 'u1',
  name: 'Amy Lin',
  full_name: 'Amy J. Lin',
  username: 'amy.lin',
  phone: '555-0100',
  image: 'http://x/amy.png',
};

/** `row` as a stripping backend (ObjectStack's `FieldMasker`) serves it. */
function stripped<T extends Record<string, unknown>>(row: T, ...denied: string[]): T {
  const copy: Record<string, unknown> = { ...row };
  for (const field of denied) delete copy[field];
  return copy as T;
}

/** A backend that does NOT strip denied keys: it serves `row` as given, to every query. */
function makeDataSource(row: Record<string, unknown> = AMY) {
  const find = vi.fn(async () => ({ data: [row], total: 1 }));
  return { find } as unknown as DataSource;
}

/** The real role-based policy, denying the named `sys_user` fields to `viewer`. */
function policyDenying(...fields: string[]): ObjectPermissionConfig[] {
  return [
    {
      object: 'sys_user',
      roles: {
        viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
      },
    } as ObjectPermissionConfig,
  ];
}

function Picker({
  policy,
  row = AMY,
  onSelect = vi.fn(),
  ...extra
}: {
  /** Omitted: no provider mounted, so no policy is loaded. */
  policy?: ObjectPermissionConfig[];
  row?: Record<string, unknown>;
  onSelect?: (value: unknown) => void;
  [prop: string]: unknown;
}) {
  const [ds] = React.useState(() => makeDataSource(row));
  const picker = (
    <PeoplePicker
      open
      objectName="sys_user"
      subtitleFields={['phone']}
      multiple
      value={['u1']}
      dataSource={ds}
      onOpenChange={() => {}}
      onSelect={onSelect}
      {...extra}
    />
  );
  if (!policy) return picker;
  return (
    <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policy}>
      {picker}
    </PermissionProvider>
  );
}

/** Wait for the candidate row and the hydrated tray chip. */
async function settled(): Promise<{ row: HTMLElement; chip: HTMLElement }> {
  await waitFor(() => expect(screen.getByTestId('person-row')).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('selection-chip')).toBeTruthy());
  return { row: screen.getByTestId('person-row'), chip: screen.getByTestId('selection-chip') };
}

/** Mount one picker and return what its row and its tray chip drew. */
async function drawn(props: React.ComponentProps<typeof Picker>) {
  render(<Picker {...props} />);
  const { row, chip } = await settled();
  const out = {
    rowText: row.textContent ?? '',
    rowHtml: row.innerHTML,
    chipText: chip.textContent ?? '',
    chipHtml: chip.innerHTML,
  };
  cleanup();
  return out;
}

/** Reports every image as loaded, so Radix's `AvatarImage` renders its `img`. */
class LoadedImage {
  complete = true;
  naturalWidth = 1;
  src = '';
  crossOrigin: string | null = null;
  referrerPolicy = '';
  addEventListener(): void {}
  removeEventListener(): void {}
}

let realImage: typeof window.Image;

beforeEach(() => {
  // No matchMedia in happy-dom; useIsMobile needs it. Default to desktop width.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  realImage = window.Image;
  window.Image = LoadedImage as unknown as typeof window.Image;
});

afterEach(() => {
  cleanup();
  window.Image = realImage;
});

describe('PeoplePicker — field-level security gates the drawn person name (objectui#10535)', () => {
  it('a denied name is not drawn in the row or the tray; the next readable source stands in, as for a stripping backend', async () => {
    const gated = await drawn({ policy: policyDenying('name') });
    const served = await drawn({ row: stripped(AMY, 'name') });

    for (const html of [gated.rowHtml, gated.chipHtml]) expect(html).not.toContain('Amy Lin');
    expect(gated.rowText).toBe('amy.lin555-0100');
    expect(gated.chipText).toBe('amy.lin');
    expect(gated.rowText).toBe(served.rowText);
    expect(gated.chipText).toBe(served.chipText);
  });

  it('a row whose name is denied can still be chosen', async () => {
    const onSelect = vi.fn();
    render(<Picker policy={policyDenying('name')} multiple={false} value={undefined} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByTestId('person-row')).toBeTruthy());

    fireEvent.click(screen.getByTestId('person-row'));
    expect(onSelect).toHaveBeenCalledWith('u1');
  });

  it('the configured display field is the rung judged first, not a literal `name`', async () => {
    const gated = await drawn({ policy: policyDenying('full_name'), displayField: 'full_name' });

    for (const html of [gated.rowHtml, gated.chipHtml]) expect(html).not.toContain('Amy J. Lin');
    expect(gated.chipText).toBe('Amy Lin');

    const readable = await drawn({ policy: policyDenying('name'), displayField: 'full_name' });
    expect(readable.chipText).toBe('Amy J. Lin');
  });

  it('with every name source denied, the row and the tray read as they do for a stripping backend', async () => {
    const gated = await drawn({ policy: policyDenying('name', 'username') });
    const served = await drawn({ row: stripped(AMY, 'name', 'username') });

    for (const html of [gated.rowHtml, gated.chipHtml]) {
      expect(html).not.toContain('Amy Lin');
      expect(html).not.toContain('amy.lin');
    }
    expect(gated.rowText).toBe(served.rowText);
    expect(gated.chipText).toBe(served.chipText);
    expect(gated.rowHtml).toBe(served.rowHtml);
    expect(gated.chipHtml).toBe(served.chipHtml);
  });

  it('a policy that changes after mount relabels the same mounted row and chip', async () => {
    const { rerender } = render(<Picker policy={[]} />);
    const { row, chip } = await settled();
    expect(row.textContent).toContain('Amy Lin');
    expect(chip.textContent).toContain('Amy Lin');

    rerender(<Picker policy={policyDenying('name')} />);

    await waitFor(() => expect(row.textContent).toBe('amy.lin555-0100'));
    // The same mounted nodes, relabelled in place — not a remount.
    expect(screen.getByTestId('person-row')).toBe(row);
    expect(screen.getByTestId('selection-chip')).toBe(chip);
    expect(chip.textContent).toBe('amy.lin');
    expect(row.innerHTML).not.toContain('Amy Lin');
    expect(chip.innerHTML).not.toContain('Amy Lin');
    expect(within(chip).getByRole('button', { name: 'Remove amy.lin' })).toBeTruthy();
  });

  it('control: a name the policy does NOT deny still prints in the row and the tray', async () => {
    const lit = await drawn({ policy: policyDenying('secret_note') });

    expect(lit.rowText).toBe('Amy Lin555-0100');
    expect(lit.chipText).toBe('Amy Lin');
    expect(lit.rowHtml).toContain('alt="Amy Lin"');
  });

  it('control: with no policy loaded (no provider), the row and the tray are named as served', async () => {
    const served = await drawn({});

    expect(served.rowText).toBe('Amy Lin555-0100');
    expect(served.chipText).toBe('Amy Lin');
  });
});
