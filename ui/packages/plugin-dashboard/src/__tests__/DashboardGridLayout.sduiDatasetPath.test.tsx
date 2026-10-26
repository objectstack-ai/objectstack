/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4614, one level out — and objectui#10859 batch 8, which removed that
 * level.
 *
 * Until objectui#10859 batch 8 (phase 2b) this file rendered
 * `DashboardGridLayout` the way a schema-driven host did: as the registered
 * `dashboard-grid` component type, resolved by `SchemaRenderer`. That key is now
 * RETIRED by unregistration (the seat's ruling on objectui#10859: builder
 * chrome, 0 producers, 0 runtime emission), so there is no SDUI trip left to
 * pin. What #4614 guarantees about the component itself — the visible dataset
 * diagnostic, the `dataSource` prop reaching the dataset query, static-data
 * widgets left on their path — is pinned where the component is mounted
 * directly, in `DashboardGridLayout.datasetPath.test.tsx`.
 *
 * What this file pins instead is the retirement's observable half: a stored
 * node that still says `type: 'dashboard-grid'` gets the renderer's visible
 * "Unknown component type" refusal — never a silent grid — while the
 * dashboard's authorable node, `dashboard`, still renders the same widget.
 *
 * The registries are imported at module scope, never in a hook (AGENTS.md
 * 测试纪律, objectui#3010).
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import '@object-ui/components';
import '@object-ui/plugin-charts';
import '../index';

afterEach(cleanup);

type StoredNode = Parameters<typeof SchemaRenderer>[0]['schema'];

const STATIC_WIDGET = { id: 'w1', type: 'bar', title: 'Static bars', options: { data: [{ name: 'A', value: 1 }] } };

describe('dashboard-grid is retired from the SDUI registry (objectui#10859 batch 8)', () => {
  it('is registered under neither spelling', () => {
    // Lit control: the authorable dashboard node is still registered.
    expect(ComponentRegistry.has('dashboard')).toBe(true);
    expect(ComponentRegistry.has('dashboard-grid')).toBe(false);
    expect(ComponentRegistry.has('plugin-dashboard:dashboard-grid')).toBe(false);
  });

  it('a stored dashboard-grid node draws the visible unknown-type refusal, not a grid', async () => {
    render(<SchemaRenderer schema={{ type: 'dashboard-grid', widgets: [STATIC_WIDGET] } as unknown as StoredNode} />);
    expect(await screen.findByText(/Unknown component type/)).toBeInTheDocument();
    expect(screen.queryByTestId('grid-layout')).toBeNull();
  });

  it('control: the same widget under the authorable `dashboard` node renders', async () => {
    render(<SchemaRenderer schema={{ type: 'dashboard', widgets: [STATIC_WIDGET] } as unknown as StoredNode} />);
    expect(await screen.findByText('Static bars')).toBeInTheDocument();
    expect(screen.queryByText(/Unknown component type/)).toBeNull();
  });
});
