/**
 * objectstack#34610 — where the console's main area goes for a draft the
 * drawer's build produced (`mainAreaDraftMove`). The app shows in the main
 * area, in the regime the build is in (ADR-0045): draft mode for changes to a
 * published app, the real app for a materialized build.
 */
import { describe, expect, it } from 'vitest';
import { mainAreaDraftMove } from '../mainAreaDraft';

const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });

describe('mainAreaDraftMove (objectstack#34610)', () => {
  it('editing the app the drawer sits beside stays on the page and enters draft mode in place', () => {
    expect(mainAreaDraftMove({ segment: 'app.crm' }, at('/apps/crm/account', '?view=all', '#top'), true)).toEqual({
      to: '/apps/crm/account?view=all&preview=draft#top',
      replace: true,
      leavesPreview: false,
    });
  });

  it('a page already under the target app counts as in place', () => {
    expect(mainAreaDraftMove({ segment: 'app.crm' }, at('/apps/app.crm/lead'), false)?.to).toBe(
      '/apps/app.crm/lead?preview=draft',
    );
  });

  it('already in draft mode on the page: nothing to navigate (the bus refresh brings the change in)', () => {
    expect(mainAreaDraftMove({ segment: 'app.crm' }, at('/apps/crm/account', '?preview=draft'), true)).toBeNull();
  });

  it('another app (a new build after it binds) opens its landing as a new history entry', () => {
    expect(mainAreaDraftMove({ segment: 'app.library' }, at('/home'), false)).toEqual({
      to: '/apps/app.library?preview=draft',
      replace: false,
      leavesPreview: false,
    });
  });

  it('a materialized build shows the real app, no draft overlay (ADR-0045)', () => {
    expect(mainAreaDraftMove({ segment: 'app.library', materialized: true }, at('/home'), false)).toEqual({
      to: '/apps/app.library',
      replace: false,
      leavesPreview: false,
    });
  });

  it('a materialized build on a previewed page leaves preview, so the sticky keeper must be told', () => {
    expect(
      mainAreaDraftMove({ segment: 'app.crm', materialized: true }, at('/apps/crm', '?preview=draft'), true),
    ).toEqual({ to: '/apps/crm', replace: true, leavesPreview: true });
  });

  it("a draft card's Preview opens the surface it drafted, even from inside the app", () => {
    expect(
      mainAreaDraftMove(
        { segment: 'app.crm', path: '/apps/app.crm/page/welcome?preview=draft' },
        at('/apps/crm/account'),
        true,
      ),
    ).toEqual({ to: '/apps/app.crm/page/welcome?preview=draft', replace: false, leavesPreview: false });
  });
});
