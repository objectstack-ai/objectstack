// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { studioChangesReviewLink, studioItemReviewLink } from './studio-review-links.js';

/**
 * objectstack#36895 — the server's draft review links, byte for byte as the CLI
 * and the MCP authoring tools spelled them before this module existed. The
 * Console's `studioChangesReviewPath` / `studioItemReviewPath` are pinned to
 * the same literals in the Console's app-shell package (`studioAddress.test.ts`).
 */
describe('the Studio review links a server hands out (objectstack#36895)', () => {
  it("a package's Changes drawer on its Studio home", () => {
    expect(studioChangesReviewLink('com.acme.crm')).toBe('/studio/com.acme.crm/data?changes=review');
    expect(studioChangesReviewLink('a b/c')).toBe('/studio/a%20b%2Fc/data?changes=review');
  });

  it("an item's draft review in the All metadata area", () => {
    expect(studioItemReviewLink('com.acme.crm', 'flow', 'crm_lead_created_notify')).toBe(
      '/studio/com.acme.crm/metadata/flow/crm_lead_created_notify?review=1',
    );
    expect(studioItemReviewLink('p q', 'object', 'a/b')).toBe('/studio/p%20q/metadata/object/a%2Fb?review=1');
  });
});
