// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `QuickActions` — "System Settings" card target (objectui#3611).
 *
 * ## This one is DORMANT, and the test says so on purpose
 *
 * Unlike the other three sites #3611 fixes, no user can reach this card today:
 * `QuickActions` has zero JSX call sites repo-wide. It is exported from
 * `console/home/index.ts` and rendered by nobody (`HomePage` builds its own
 * tiles). So there is no user-visible behavior change here and nothing to
 * verify through a mounted page.
 *
 * It was fixed anyway, in the same pass, for one reason: the day someone
 * remounts this component on `/home`, the dead link comes back with it. This
 * file is the guard that makes that reappearance impossible — it renders the
 * component DIRECTLY (the honest scope for dormant code) rather than pretending
 * a route reaches it.
 *
 * ## The target
 *
 * Same root cause as its three live siblings: `AppContent` mounts the system
 * hub only on `isSystemRoute`, so a bare `/apps/setup` is the "No Apps
 * Configured" empty state's own URL on a zero-app deployment. The card's
 * sibling ("Manage Objects") already spelled `/apps/setup/system/...`, which is
 * what made this one the odd entry out.
 *
 * ## The "Manage Objects" card (objectui#3739)
 *
 * That sibling's `/apps/setup/system/...` prefix is what made it the anchor for
 * #3611 — and it was the wrong URL for a different reason, unnoticed at the
 * time. `…/system/metadata/object` is not a page: `apps/console`'s host fragment
 * serves it with `MetadataRedirect`, a bare `<Navigate>` onto
 * `/apps/setup/metadata/object`, so the card bought a redundant hop plus a
 * re-render. It is the third of the three producers #3739 re-points; the other
 * two are the `sys-objects` entries in both sidebars
 * (`layout/__tests__/systemNavSettingsTarget.test.tsx`).
 *
 * So the third case below is REWRITTEN, not extended: it used to assert this
 * card as the untouched consistency anchor, and that premise is what #3739
 * falsified. It now pins the canonical target — the same discipline as the
 * sidebar suites, which replace the old shape rather than keeping the bug and
 * the fix side by side. Whether that URL resolves in one hop is a property of
 * the URL rather than of this producer, and is measured in
 * `layout/__tests__/systemNavObjectsHop.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

import { QuickActions } from '../QuickActions';

/** Reports where a card's navigate() actually put the router. */
function Landing() {
  const { pathname } = useLocation();
  return <div data-testid="landing">{pathname}</div>;
}

function renderQuickActions() {
  render(
    <MemoryRouter initialEntries={['/home']}>
      <QuickActions />
      <Routes>
        <Route path="*" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SYSTEM_HUB = '/apps/setup/system';

/** Where the metadata-admin engine really serves the object list (objectui#3739). */
const OBJECTS_TARGET = '/apps/setup/metadata/object';

describe('QuickActions system-settings card (objectui#3611, dormant)', () => {
  it('DORMANCY PRECONDITION: nothing renders this component, so the fix is a guard, not a user-visible change', async () => {
    // Recorded as an assertion rather than prose so it goes red the day the
    // component is remounted — at which point the pin below stops being a
    // guard and becomes a live-path test, and this file should be re-read.
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const here = path.dirname(fileURLToPath(import.meta.url));
    // .../src/console/home/__tests__ -> .../src
    const srcRoot = path.resolve(here, '../../..');

    const callSites: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx$/.test(entry.name) && !/\.(test|spec)\.tsx$/.test(entry.name)) {
          if (/<QuickActions\b/.test(readFileSync(full, 'utf8'))) callSites.push(full);
        }
      }
    };
    if (statSync(srcRoot).isDirectory()) walk(srcRoot);

    expect(callSites).toEqual([]);
  });

  it('the System Settings card targets the system hub, not the bare setup URL', async () => {
    const user = userEvent.setup();
    renderQuickActions();

    await user.click(screen.getByTestId('quick-action-system-settings'));

    expect(screen.getByTestId('landing')).toHaveTextContent(SYSTEM_HUB);
  });

  it('the Manage Objects card targets the canonical metadata route, not the system alias (objectui#3739)', async () => {
    // Replaces #3611's "the sibling is unchanged" anchor. That assertion was
    // true of the URL and wrong about it: `…/system/metadata/object` is an alias
    // the host only forwards, so pinning it froze the extra hop in place.
    const user = userEvent.setup();
    renderQuickActions();

    await user.click(screen.getByTestId('quick-action-manage-objects'));

    expect(screen.getByTestId('landing')).toHaveTextContent(OBJECTS_TARGET);
    // `toHaveTextContent` matches on substring, and neither spelling contains
    // the other (`/apps/setup/system/metadata/object` has the extra segment in
    // the MIDDLE), so the assertion above already separates them. This second
    // one adds nothing to the logic and is kept for the diff: a revert then
    // fails naming the alias, instead of reporting two similar-looking paths.
    expect(screen.getByTestId('landing')).not.toHaveTextContent(
      `${SYSTEM_HUB}/metadata/object`,
    );
  });
});
