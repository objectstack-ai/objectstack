/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The read-only user cell draws a person's name and avatar from the fields the
 * viewer may read — objectui#10535.
 *
 * Under the renderer-side FLS rulings (objectui#7215 / objectui#7230)
 * field-level security gates the OUTPUT. `UserCellRenderer` drew the name
 * (`name`, then `username`) and the avatar (`image`, as the `AvatarImage`
 * src) straight off an expanded person row, in its single and its multi
 * branch, so on a backend that does not strip denied keys (ObjectStack's
 * `FieldMasker` does) a denied name printed and a denied image URL was
 * requested. The lookup cell (objectui#10501) and the lookup editor's option
 * label (objectui#10411) already read the row with the denied fields removed,
 * `id` kept; the user cell now does the same, so every denial pin below also
 * compares it with the cell fed the stripped row.
 *
 * What is pinned, against the real `PermissionProvider` (not a stub):
 *
 *  - single and multi: a denied name and a denied image are not drawn; the
 *    cell reads exactly as a stripping backend's row makes it read;
 *  - the person's object is the field's `reference`, and `sys_user` when it
 *    names none — the answer `UserField` gives the picker; a retired
 *    `reference_to` names nothing (objectui#11070 round 4);
 *  - a policy that changes after mount relabels the SAME mounted cell;
 *  - lit controls: fields the policy does NOT deny still print, and with no
 *    policy loaded (no provider: `isLoaded` is false) the row is drawn as
 *    served — so the pins above read a GATE, not a name that went missing.
 *
 * `LoadedImage` reports every image as loaded, so Radix's `AvatarImage`
 * renders an `img` exactly when an image URL reached it; the controls assert
 * that `img`, which is what lets the denial legs fail.
 */

import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { FieldMetadata, ObjectPermissionConfig } from '@object-ui/types';
import { UserCellRenderer } from '../index';

const AMY = { id: 'u1', name: 'Amy Lin', username: 'amy.lin', image: 'http://x/amy.png' };
const BEN = { id: 'u2', name: 'Ben Ode', username: 'ben.ode', image: 'http://x/ben.png' };
const SECRETS = ['Amy Lin', 'Ben Ode', 'http://x/amy.png', 'http://x/ben.png'];

/** `row` as a stripping backend (ObjectStack's `FieldMasker`) serves it. */
function stripped<T extends Record<string, unknown>>(row: T, ...denied: string[]): T {
  const copy: Record<string, unknown> = { ...row };
  for (const field of denied) delete copy[field];
  return copy as T;
}

/** The real role-based policy, denying the named fields of `objectName` to `viewer`. */
function policyDenying(objectName: string, ...fields: string[]): ObjectPermissionConfig[] {
  return [
    {
      object: objectName,
      roles: {
        viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
      },
    } as ObjectPermissionConfig,
  ];
}

const USER_FIELD = { type: 'user' } as FieldMetadata;

function Cell({
  value,
  field = USER_FIELD,
  policy,
}: {
  value: unknown;
  field?: FieldMetadata;
  /** Omitted: no provider mounted, so no policy is loaded. */
  policy?: ObjectPermissionConfig[];
}) {
  const cell = (
    <div data-testid="cell">
      <UserCellRenderer value={value} field={field} />
    </div>
  );
  if (!policy) return cell;
  return (
    <PermissionProvider roles={[]} userRoles={['viewer']} permissions={policy}>
      {cell}
    </PermissionProvider>
  );
}

/** Render one cell and return what it drew. */
function drawn(props: React.ComponentProps<typeof Cell>): { text: string; html: string; imgs: string[] } {
  render(<Cell {...props} />);
  const el = screen.getByTestId('cell');
  const out = {
    text: el.textContent ?? '',
    html: el.innerHTML,
    imgs: Array.from(el.querySelectorAll('img')).map((img) => img.getAttribute('src') ?? ''),
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
  realImage = window.Image;
  window.Image = LoadedImage as unknown as typeof window.Image;
});

afterEach(() => {
  cleanup();
  window.Image = realImage;
});

describe('UserCellRenderer — the name and the avatar are drawn from the fields the viewer may read (objectui#10535)', () => {
  it('single: a denied name and a denied image are not drawn; the cell reads as a stripping backend makes it read', () => {
    const gated = drawn({ value: AMY, policy: policyDenying('sys_user', 'name', 'image') });
    const served = drawn({ value: stripped(AMY, 'name', 'image') });

    for (const secret of SECRETS) expect(gated.html).not.toContain(secret);
    expect(gated.imgs).toEqual([]);
    expect(gated.text).toContain('amy.lin');
    expect(gated.html).toBe(served.html);
  });

  it('multi: no avatar in the stack draws a denied name (its title) or a denied image', () => {
    const gated = drawn({ value: [AMY, BEN], policy: policyDenying('sys_user', 'name', 'image') });
    const served = drawn({ value: [stripped(AMY, 'name', 'image'), stripped(BEN, 'name', 'image')] });

    for (const secret of SECRETS) expect(gated.html).not.toContain(secret);
    expect(gated.imgs).toEqual([]);
    expect(gated.html).toContain('title="amy.lin"');
    expect(gated.html).toContain('title="ben.ode"');
    expect(gated.html).toBe(served.html);
  });

  it("the person's object is the field's `reference`, and `sys_user` when it names none", () => {
    // `reference` is the spec's spelling and, since objectui#11070 round 4, the
    // only one read. `UserFieldMetadata` does not declare it, hence the cast.
    const field = { type: 'user', reference: 'crm_member' } as unknown as FieldMetadata;
    const gated = drawn({ value: AMY, field, policy: policyDenying('crm_member', 'name', 'image') });
    for (const secret of SECRETS) expect(gated.html).not.toContain(secret);

    // A policy on `sys_user` says nothing about a field that points elsewhere.
    const elsewhere = drawn({ value: AMY, field, policy: policyDenying('sys_user', 'name', 'image') });
    expect(elsewhere.text).toContain('Amy Lin');
    expect(elsewhere.imgs).toEqual(['http://x/amy.png']);
  });

  it('a retired `reference_to` names no person object — the cell reads `sys_user` (objectui#11070 round 4)', () => {
    const field = { type: 'user', reference_to: 'crm_member' } as unknown as FieldMetadata;
    // The retired spelling is read by nothing, so a policy on `crm_member`
    // does not reach this field…
    const unreached = drawn({ value: AMY, field, policy: policyDenying('crm_member', 'name', 'image') });
    expect(unreached.text).toContain('Amy Lin');
    // …and the cell answers `sys_user`, as for a field that names none.
    const fallback = drawn({ value: AMY, field, policy: policyDenying('sys_user', 'name', 'image') });
    for (const secret of SECRETS) expect(fallback.html).not.toContain(secret);
  });

  it('a policy that changes after mount relabels the same mounted cell', () => {
    const { rerender } = render(<Cell value={AMY} policy={[]} />);
    const label = screen.getByTitle('Amy Lin');
    expect(screen.getByTestId('cell').querySelector('img')?.getAttribute('src')).toBe('http://x/amy.png');

    rerender(<Cell value={AMY} policy={policyDenying('sys_user', 'name', 'image')} />);

    // The same mounted label, relabelled in place — not a remount.
    expect(screen.getByTitle('amy.lin')).toBe(label);
    expect(screen.getByTestId('cell').querySelector('img')).toBeNull();
    for (const secret of SECRETS) expect(screen.getByTestId('cell').innerHTML).not.toContain(secret);
  });

  it('control: fields the policy does NOT deny still print, single and multi', () => {
    const single = drawn({ value: AMY, policy: policyDenying('sys_user', 'secret_note') });
    expect(single.text).toContain('Amy Lin');
    expect(single.imgs).toEqual(['http://x/amy.png']);

    const multi = drawn({ value: [AMY, BEN], policy: policyDenying('sys_user', 'secret_note') });
    expect(multi.html).toContain('title="Amy Lin"');
    expect(multi.imgs).toEqual(['http://x/amy.png', 'http://x/ben.png']);
  });

  it('control: with no policy loaded (no provider), the row is drawn as served', () => {
    const served = drawn({ value: AMY });
    expect(served.text).toContain('Amy Lin');
    expect(served.imgs).toEqual(['http://x/amy.png']);
  });
});
