/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10859 batch 8, phase 2d — inside the app shell, a `sidebar` node
 * does NOT mount a second `SidebarProvider` (the premise of the seat's fork
 * ruling, "Fork 3": a host's provider must never be shadowed).
 *
 * `AppShell` (this package; the console's `ConsoleLayout` renders through it)
 * mounts the shell's provider itself, importing `SidebarProvider` from
 * `@object-ui/components` — the same module the `sidebar` registration reads
 * its context from. So the node finds the shell's provider, and:
 *
 *   - the tree holds exactly one provider wrapper (`group/sidebar-wrapper`);
 *   - the shell's state drives the node: the shell opens collapsed
 *     (`defaultOpen={false}`), and the shell's own trigger expands it.
 *
 * The bare-host half (no provider above, so the node mounts one) is pinned in
 * `@object-ui/components`' `renderers/__tests__/sidebar-node-provider-10859.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import { SidebarTrigger } from '@object-ui/components';

import { AppShell } from '../index';

const providers = (c: HTMLElement) => c.querySelectorAll('[class*="group/sidebar-wrapper"]').length;
const nodeState = (c: HTMLElement) =>
  c.querySelector('main [data-state][data-collapsible]')?.getAttribute('data-state') ?? null;

describe('a sidebar node inside AppShell uses the shell provider (objectui#10859 batch 8)', () => {
  it("keeps one provider, and the shell's trigger drives the node", () => {
    const { container, getByRole } = render(
      <AppShell defaultOpen={false} navbar={<SidebarTrigger />}>
        <SchemaRenderer schema={{ type: 'sidebar', children: [{ type: 'text', content: 'Node item' }] } as never} />
      </AppShell>,
    );

    expect(container.textContent).toContain('Node item');
    expect(providers(container)).toBe(1);
    expect(nodeState(container)).toBe('collapsed');

    fireEvent.click(getByRole('button', { name: /toggle sidebar/i }));
    expect(providers(container)).toBe(1);
    expect(nodeState(container)).toBe('expanded');
  });
});
