// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36502 — where an old Interfaces URL lands, as data: the scope's
 * Studio home (the Data pillar), carrying `?changes=` and nothing else of the
 * retired pillar's query, and the state that tells the home to say why.
 * The render (the redirect through the real surface, the notice, its link
 * back to the app) is `StudioDesignSurface.interfacesRetired-36502`.
 */

import { describe, expect, it } from 'vitest';
import {
  INTERFACES_RETIRED_STATE,
  RETIRED_INTERFACES_SEGMENT,
  STUDIO_HOME_PILLAR,
  isRetiredInterfacesLanding,
  retiredInterfacesState,
  retiredInterfacesTarget,
} from './studioInterfacesRetired';
import { STUDIO_CHANGES_PARAM, STUDIO_CHANGES_REVIEW } from './studioChangesLink';

describe('retiredInterfacesTarget (objectstack#36502)', () => {
  it('lands a bare old URL on the scope’s Data pillar', () => {
    expect(STUDIO_HOME_PILLAR).toBe('data');
    expect(RETIRED_INTERFACES_SEGMENT).toBe('interfaces');
    expect(retiredInterfacesTarget('com.acme.app', '')).toBe('/studio/com.acme.app/data');
  });

  it('drops the retired pillar’s own deep link', () => {
    expect(retiredInterfacesTarget('com.acme.app', '?surface=dashboard%3Aops_board')).toBe('/studio/com.acme.app/data');
    expect(retiredInterfacesTarget('com.acme.app', 'surface=view%3Atask.all&canvas=run')).toBe('/studio/com.acme.app/data');
  });

  it('keeps the Changes drawer request, which is the surface’s, not the pillar’s', () => {
    expect(STUDIO_CHANGES_PARAM).toBe('changes');
    expect(retiredInterfacesTarget('com.acme.app', `?${STUDIO_CHANGES_PARAM}=${STUDIO_CHANGES_REVIEW}`)).toBe(
      '/studio/com.acme.app/data?changes=review',
    );
    expect(
      retiredInterfacesTarget('com.acme.app', `?surface=page%3Ahome&${STUDIO_CHANGES_PARAM}=${STUDIO_CHANGES_REVIEW}`),
    ).toBe('/studio/com.acme.app/data?changes=review');
  });

  it('encodes the scope segment as the route spells it', () => {
    expect(retiredInterfacesTarget('~org', '')).toBe('/studio/~org/data');
    expect(retiredInterfacesTarget('a b', '')).toBe('/studio/a%20b/data');
  });
});

describe('the landing state (objectstack#36502)', () => {
  it('marks a landing from an old URL, and nothing else', () => {
    expect(retiredInterfacesState()).toEqual({ [INTERFACES_RETIRED_STATE]: true });
    expect(isRetiredInterfacesLanding(retiredInterfacesState())).toBe(true);
    // CONTROL: an ordinary arrival, another state, a near miss.
    expect(isRetiredInterfacesLanding(null)).toBe(false);
    expect(isRetiredInterfacesLanding(undefined)).toBe(false);
    expect(isRetiredInterfacesLanding({ from: '/apps/x' })).toBe(false);
    expect(isRetiredInterfacesLanding({ [INTERFACES_RETIRED_STATE]: 'yes' })).toBe(false);
    expect(isRetiredInterfacesLanding('studioInterfacesRetired')).toBe(false);
  });
});
