/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `ConsoleShell` SUPPLIES the deployment's default map style (objectstack#26163).
 *
 * The runtime serves the operator's `OS_CONSOLE_MAP_STYLE_URL` as the top-level
 * `mapStyleUrl` of `GET /api/v1/runtime/config` (objectstack#26001), and the map
 * renderer reads it through `useHostMapStyle()` from `@object-ui/react`. The map
 * is a lazily registered plugin, so nothing but this context reaches it; this
 * file pins that the console actually mounts the provider with the served value,
 * which no test of the renderer or of the config reader can see.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHostMapStyle } from '@object-ui/react';
import { ConsoleShell } from '../ConsoleShell';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

// Same two stubs the sibling ConsoleShell tests use: sonner is a global toast
// surface, and the ADR-0069 remediation gate needs an AuthProvider above it.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
    dismiss: vi.fn(), custom: vi.fn(), loading: vi.fn(), promise: vi.fn(),
  }),
  Toaster: () => null,
}));
vi.mock('../RemediationOverlay', () => ({ RemediationOverlay: () => null }));

const STYLE = 'https://tiles.intranet.example/styles/basic/style.json';

/** A stand-in for the map renderer below the shell. */
function MapStub() {
  const style = useHostMapStyle();
  return <div data-testid="host-map-style">{style ?? 'none'}</div>;
}

async function boot(payload: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })) as any);
  await initRuntimeConfig();
  render(
    <MemoryRouter>
      <ConsoleShell>
        <MapStub />
      </ConsoleShell>
    </MemoryRouter>,
  );
}

afterEach(() => {
  resetRuntimeConfigForTesting();
  vi.unstubAllGlobals();
});

describe('ConsoleShell — the console supplies the deployment map style (objectstack#26163)', () => {
  it('hands the served mapStyleUrl to every renderer below it', async () => {
    await boot({ mapStyleUrl: STYLE });
    await waitFor(() => expect(screen.getByTestId('host-map-style').textContent).toBe(STYLE));
  });

  it('hands nothing when the runtime serves no mapStyleUrl', async () => {
    await boot({ singleEnvironment: true });
    await waitFor(() => expect(screen.getByTestId('host-map-style').textContent).toBe('none'));
  });
});
