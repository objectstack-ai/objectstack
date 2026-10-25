// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11798 — `studio:builder` is registered at boot, and the builder it
 * renders loads only when that entry is first rendered.
 *
 * ## What this replaces, and why its old assertion is now the wrong one
 *
 * objectui#5486 pinned the opposite: that the builder rendered on the FIRST
 * commit, with no Suspense boundary in front of it. That was right for its
 * tree. The registration then wrapped `import('@object-ui/app-shell')`, the
 * barrel this file and `App.tsx` imported statically, so the `lazy()` deferred
 * nothing and only bought a fallback no user could see. objectui#5486 made the
 * registration truthful and left genuine laziness to a separate measured card.
 *
 * objectui#11798 is that card. The registration now reaches `BuilderLanding`
 * through `./components/studioBuilder`, a console-local module nothing imports
 * statically, so the boundary is real: the builder's chunk leaves the eager
 * closure (measured on the built console, see the PR), and the entry shows a
 * loading line until it arrives. The property worth pinning therefore flips,
 * and it is pinned the same way objectui#5486 pinned its own, by what React
 * commits rather than by the source's spelling.
 *
 * ## The two halves
 *
 *  - REGISTRY: importing this module registers `studio:builder` and evaluates
 *    nothing of the builder. `ComponentNavView` finds the entry the moment the
 *    console boots, exactly as before.
 *  - RENDER: the entry commits its loading line first, then the landing once
 *    the module resolves. A boundary that deferred nothing (the objectui#5486
 *    shape) commits the landing on the first commit and reds the first half.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';

type Registration = { ref: string; label?: string; source?: string; component: ComponentType };

const { registrations, builderModuleLoads } = vi.hoisted(() => ({
  registrations: [] as Registration[],
  builderModuleLoads: { count: 0 },
}));

// Mocked at the specifier the module under test imports, so the entry exercised
// below is the production registration itself. The real barrel's surface is
// inherited (`check:vi-mock-inherit`); only the names this file's graph renders
// or records are overridden.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerAppComponent: (entry: Registration) => {
    registrations.push(entry);
  },
  // The barrel's own builder, as a marker: the entry must reach the landing
  // only through the deferred module below, so registering this one instead
  // commits the marker with no loading line and reds the render case.
  BuilderLanding: () => <div data-testid="barrel-builder" />,
  // `StudioRoute.tsx` is imported for its shared loading line; these are the
  // other names its module graph reads from the barrel.
  ConnectedShell: ({ children }: { children?: ReactNode }) => <>{children}</>,
  RequireOrganization: ({ children }: { children?: ReactNode }) => <>{children}</>,
  RedirectWithSplash: () => null,
  LoadingFallback: () => null,
  LoadingScreen: () => null,
  STUDIO_ORG_SCOPE_SEGMENT: '~org',
  STUDIO_ORG_SCOPE_PILLAR: 'automations',
  getProductName: () => 'ObjectOS',
  useHomePath: () => '/home',
}));

// The deferred module. Its factory runs when the module is first imported, so
// the count is the unit-level image of "the builder's chunk was fetched".
vi.mock('../components/studioBuilder', () => {
  builderModuleLoads.count += 1;
  return {
    BuilderLanding: () => <div data-testid="builder-landing" />,
    StudioDesignSurface: () => null,
  };
});

// Side-effect import, exactly as `main.tsx` performs it.
import '../registerStudioComponents';

function entryFor(ref: string): Registration {
  const found = registrations.find((r) => r.ref === ref);
  if (!found) throw new Error(`no registration for ${ref}; saw: ${registrations.map((r) => r.ref).join(', ') || '(none)'}`);
  return found;
}

describe('studio:builder registration (objectui#11798)', () => {
  it('is registered at boot, and registering evaluates nothing of the builder', () => {
    const entry = entryFor('studio:builder');
    expect(entry.source).toBe('@object-ui/console');
    expect(entry.label).toBe('应用构建');
    expect(builderModuleLoads.count).toBe(0);
  });

  it('commits a loading line first, then the landing once its module resolves', async () => {
    const Builder = entryFor('studio:builder').component;
    render(<Builder />);

    // No `await`: the first commit. A boundary that deferred nothing would have
    // committed the landing here, which is the objectui#5486 shape.
    // The fallback is found by its role, not by its copy: the words are the
    // translation catalogue's, and this file pins only that a wait is shown.
    expect(screen.queryByTestId('builder-landing')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await screen.findByTestId('builder-landing')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(builderModuleLoads.count).toBe(1);
  });
});
