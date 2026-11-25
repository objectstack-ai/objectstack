// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36903 — the retired Automations pillar's addresses land on the
 * flow's designer or the flow list, of the package or of the package-less
 * scope, their own qualifiers dropped and everything else kept verbatim.
 */

import { describe, it, expect } from 'vitest';
import { automationsPillarRedirect } from './automationsPillarRedirect';

const PKG = 'com.acme.crm';

describe('automationsPillarRedirect', () => {
  it('a package\'s flow opens its designer; the bare pillar, the flow list', () => {
    expect(automationsPillarRedirect(PKG, '?surface=flow%3Anotify_owner')).toBe(`/studio/${PKG}/metadata/flow/notify_owner`);
    expect(automationsPillarRedirect(PKG, '')).toBe(`/studio/${PKG}/metadata/flow`);
    // A surface naming another type opens nothing of its own: the list.
    expect(automationsPillarRedirect(PKG, '?surface=object%3Aaccount')).toBe(`/studio/${PKG}/metadata/flow`);
  });

  it('drops the pillar\'s qualifiers and keeps the rest verbatim, the server\'s review link included', () => {
    expect(automationsPillarRedirect(PKG, '?surface=flow%3Af&view=x&nav=y&changes=review')).toBe(
      `/studio/${PKG}/metadata/flow/f?changes=review`,
    );
    expect(automationsPillarRedirect(PKG, '?changes=review&package=' + PKG)).toBe(
      `/studio/${PKG}/metadata/flow?changes=review&package=${PKG}`,
    );
  });

  it('the package-less scope lands on its own leg, with no package and its source filter once', () => {
    expect(automationsPillarRedirect('~org', '')).toBe('/studio/~org/metadata/flow?source=runtime');
    expect(automationsPillarRedirect('~org', '?surface=flow%3Aqa_clone')).toBe('/studio/~org/metadata/flow/qa_clone?source=runtime');
    expect(automationsPillarRedirect('~org', '?surface=flow%3Aqa_clone&package=x&source=artifact&changes=review')).toBe(
      '/studio/~org/metadata/flow/qa_clone?source=runtime&changes=review',
    );
  });

  it('a name with reserved characters round-trips', () => {
    const to = automationsPillarRedirect(PKG, `?surface=${encodeURIComponent('flow:a b')}`);
    expect(to).toBe(`/studio/${PKG}/metadata/flow/a%20b`);
  });
});
