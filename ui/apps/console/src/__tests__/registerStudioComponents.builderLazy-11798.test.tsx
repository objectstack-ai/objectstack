// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11798, objectstack#36908 — `studio:builder` is registered at boot,
 * and it forwards to Studio's entry.
 *
 * The entry drew the Studio home's package cards inside the app shell, loaded
 * with the builder's chunk (objectui#11798). That home was removed
 * (objectstack#36908, epic #36890 decision 9), so the entry forwards to bare
 * `/studio`, whose one owner (`StudioRoute`) opens the package the author was
 * last in, else the package list. Forwarding renders nothing of the builder,
 * so it loads nothing of it either.
 *
 *  - REGISTRY: importing this module registers `studio:builder` and evaluates
 *    nothing of the builder. `ComponentNavView` finds the entry the moment the
 *    console boots, exactly as before.
 *  - RENDER: the entry lands on `/studio` and still evaluates nothing of the
 *    builder: the `/studio` route loads it behind its gate.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

type Registration = { ref: string; label?: string; source?: string; component: ComponentType };

const { registrations, builderModuleLoads } = vi.hoisted(() => ({
  registrations: [] as Registration[],
  builderModuleLoads: { count: 0 },
}));

// Mocked at the specifier the module under test imports, so the entry exercised
// below is the production registration itself. The real barrel's surface is
// inherited (`check:vi-mock-inherit`); only the registry is overridden.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerAppComponent: (entry: Registration) => {
    registrations.push(entry);
  },
}));

// The deferred module. Its factory runs when the module is first imported, so
// the count is the unit-level image of "the builder's chunk was fetched".
vi.mock('../components/studioBuilder', () => {
  builderModuleLoads.count += 1;
  return { StudioEntryRedirect: () => null, StudioDesignSurface: () => null };
});

// Side-effect import, exactly as `main.tsx` performs it.
import '../registerStudioComponents';

function entryFor(ref: string): Registration {
  const found = registrations.find((r) => r.ref === ref);
  if (!found) throw new Error(`no registration for ${ref}; saw: ${registrations.map((r) => r.ref).join(', ') || '(none)'}`);
  return found;
}

describe('studio:builder registration (objectui#11798, objectstack#36908)', () => {
  it('is registered at boot, and registering evaluates nothing of the builder', () => {
    const entry = entryFor('studio:builder');
    expect(entry.source).toBe('@object-ui/console');
    expect(entry.label).toBe('应用构建');
    expect(builderModuleLoads.count).toBe(0);
  });

  it("forwards to Studio's entry, bare `/studio`, and loads nothing of the builder", async () => {
    const Builder = entryFor('studio:builder').component;
    render(
      <MemoryRouter initialEntries={['/apps/studio/component/studio/builder']}>
        <Routes>
          <Route path="/apps/studio/component/studio/builder" element={<Builder />} />
          <Route path="/studio" element={<div data-testid="studio-entry" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('studio-entry')).toBeInTheDocument();
    expect(builderModuleLoads.count).toBe(0);
  });
});
