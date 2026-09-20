// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18605] `enableOnInstall` — ONE AUTHORITY, and the two re-reads under it.
 *
 * The card measured the key declared in three published schemas. #18752 closed
 * the first half of the ruling (the install door now honours it). This file
 * pins the SECOND half — which of the other two declarations is a copy of the
 * request key and which means something else — so neither the fold nor a
 * silent unification can happen unobserved:
 *
 * 1. The authority is `PackageInstallRequestSchema` (`package-api.zod.ts`),
 *    the request contract of `POST /api/v1/packages`.
 * 2. `InstallPackageRequestSchema` (`kernel/package-registry.zod.ts`) is a
 *    COPY of the request key. It cannot be folded to a structural reference —
 *    the authority sits above `kernel/` in the module graph, so
 *    `PackageInstallRequestSchema.shape.enableOnInstall` spelled there is an
 *    import cycle that dies under `OS_EAGER_SCHEMAS=1`, the mode `gen:schema`
 *    and `check:authorable-surface` run in. The reference is therefore
 *    MECHANICAL and lives here: the two declarations are parsed over one
 *    matrix, and any drift on any cell reds.
 * 3. `MarketplaceInstallRequestSchema` (`marketplace/marketplace.zod.ts`)
 *    means something else and stays. Its subject is a marketplace LISTING and
 *    its door is the control plane's, not this platform's install door — so
 *    what is pinned here is the difference that carries that reading, not the
 *    sameness.
 */

import { describe, it, expect } from 'vitest';
import { PackageInstallRequestSchema } from './package-api.zod';
import { InstallPackageRequestSchema } from '../kernel/package-registry.zod';
import { MarketplaceInstallRequestSchema } from '../marketplace/marketplace.zod';

/** A manifest both install-request contracts accept, so only the key varies. */
const MANIFEST = {
  id: 'com.acme.crm',
  name: 'Acme CRM',
  version: '1.0.0',
  type: 'app',
} as const;

/**
 * The matrix. Each cell is a body the two contracts must answer identically —
 * absent (the default), both booleans, and the non-boolean spelling the door
 * itself treats as absent (recorded on `PackageInstallBodySchema`'s residual).
 */
const MATRIX: ReadonlyArray<{ name: string; enableOnInstall?: unknown }> = [
  { name: 'absent — the declared default applies' },
  { name: 'false — install present, not active', enableOnInstall: false },
  { name: 'true — the default, spelled', enableOnInstall: true },
  { name: "'false' — a string, refused by the declaration", enableOnInstall: 'false' },
  { name: 'null — refused by the declaration', enableOnInstall: null },
];

describe('#18605 — `enableOnInstall` has ONE authority', () => {
  describe('the authority: `PackageInstallRequestSchema`', () => {
    it('defaults to `true` — the value the install door installs enabled on', () => {
      const parsed = PackageInstallRequestSchema.parse({ manifest: MANIFEST });
      expect(parsed.enableOnInstall).toBe(true);
    });

    it('carries `false` through — the value the install door installs disabled on', () => {
      const parsed = PackageInstallRequestSchema.parse({ manifest: MANIFEST, enableOnInstall: false });
      expect(parsed.enableOnInstall).toBe(false);
    });

    it('refuses a non-boolean by name rather than coercing it', () => {
      const result = PackageInstallRequestSchema.safeParse({ manifest: MANIFEST, enableOnInstall: 'false' });
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((i) => i.path.join('.') === 'enableOnInstall')).toBe(true);
    });
  });

  /**
   * ⭐ THE REFERENCE, made mechanical. `InstallPackageRequestSchema` restates
   * the authority's key; this is what holds the restatement equal to it in the
   * absence of an import that would be a cycle.
   */
  describe('the COPY: `kernel/InstallPackageRequestSchema` answers exactly as the authority does', () => {
    for (const cell of MATRIX) {
      it(`agrees with the authority — ${cell.name}`, () => {
        const body: Record<string, unknown> = { manifest: MANIFEST };
        if ('enableOnInstall' in cell) body.enableOnInstall = cell.enableOnInstall;

        const authority = PackageInstallRequestSchema.safeParse(body);
        const copy = InstallPackageRequestSchema.safeParse(body);

        expect(copy.success).toBe(authority.success);
        if (authority.success && copy.success) {
          expect(copy.data.enableOnInstall).toBe(authority.data.enableOnInstall);
        }
      });
    }

    it('declares the key with the same type and default, not merely the same name', () => {
      const authorityOnly = PackageInstallRequestSchema.parse({ manifest: MANIFEST }).enableOnInstall;
      const copyOnly = InstallPackageRequestSchema.parse({ manifest: MANIFEST }).enableOnInstall;
      expect(typeof copyOnly).toBe('boolean');
      expect(copyOnly).toBe(authorityOnly);
    });
  });

  /**
   * ⛔ The marketplace declaration is NOT folded, and these are the measured
   * differences that say why. If a later change makes this request a second
   * spelling of the install door's body, these reds are the notice.
   */
  describe('the OTHER MEANING: `MarketplaceInstallRequestSchema` is a different request', () => {
    it('is keyed by a marketplace LISTING, not by a manifest', () => {
      expect(Object.keys(MarketplaceInstallRequestSchema.shape)).toContain('listingId');
      expect(Object.keys(MarketplaceInstallRequestSchema.shape)).not.toContain('manifest');
    });

    it('refuses the install door\'s body — nothing can send one where the other is expected', () => {
      expect(MarketplaceInstallRequestSchema.safeParse({ manifest: MANIFEST }).success).toBe(false);
      expect(PackageInstallRequestSchema.safeParse({ listingId: 'com.acme.crm' }).success).toBe(false);
    });

    it('declares `enableOnInstall` in its own right, defaulting to `true`', () => {
      const parsed = MarketplaceInstallRequestSchema.parse({ listingId: 'com.acme.crm' });
      expect(parsed.enableOnInstall).toBe(true);
    });
  });
});
