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
 *
 * ## ⭐ [#19273] THE 缺省 CELL FLIPPED — and this is the registered reason
 *
 * When this file was written, every 缺省 (absent) reading below was `true`,
 * because all three declarations spelled `z.boolean().default(true)`. They now
 * spell `z.boolean().optional()` and the 缺省 readings are `undefined`.
 *
 * ⛔ That is a FLIP, not a repair: the install door was ruled onto
 * 「缺省 = 保持，有旗 = 设置」 (maintainer batch #157 item 5 letter C) and stopped
 * making any lifecycle call on an absent key, which left the declarations
 * claiming a default the runtime deliberately no longer applies. The
 * declarations followed in maintainer batch #210 item 4 letter A.
 *
 * ⚠️ {@link FLIP_TRIGGER} is registered HERE, WITH the flip — ⛔ it was NOT
 * pre-registered when this pin landed. Measured on the parent commit: this
 * file carried the phrase nowhere, and no flip or trigger note of any kind
 * (zero hits for 缺省 / 保持 / 有旗 / flip / trigger, against `MATRIX` and
 * `absent` as the controls proving the file was read). The card's own protocol
 * — 「本卡 pin 断言兄弟卡在改的行为 ⇒ 在用例内预登记翻转触发词」 — expected a
 * pin asserting a behaviour a sibling card was already changing to carry the
 * trigger in advance, and that did not happen. ⭐ The gap is left recorded
 * rather than papered over, because a reader who learns the pre-registration
 * was MISSED is better served than one told it happened: the lesson is that a
 * pin written against a contested cell needs its trigger at the moment the pin
 * lands, when the contest is known, not at the moment the cell finally moves.
 *
 * ⭐ What did NOT move, and is re-read below precisely because of that: the
 * `true` and `false` arms. A fix that makes absence visible by making the key
 * mean nothing would be worse than the defect it closes, so both booleans are
 * asserted after the flip rather than assumed to have survived it.
 *
 * ⛔ Only the 缺省 cell moved. The string and `null` cells still refuse, and
 * the authority/copy agreement is still judged cell by cell — the flip is one
 * row of the matrix, never a relaxation of the matrix.
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
 * ⭐ THE FLIP-TRIGGER, registered in this file rather than patched away.
 *
 * The phrase the install door was ruled onto. While the declarations spelled
 * `.default(true)`, every assertion here read the 缺省 cell as `true` — and
 * that reading was known to be living on borrowed time, because this phrase
 * says absence is a state the door ACTS ON (by making no lifecycle call at
 * all), and a `.default()` resolves absence at parse time so the state cannot
 * survive to the published surface.
 *
 * So: a 缺省 reading of `undefined` below is this trigger having fired. It is
 * spelled once, here, and quoted into the cell name so a test run prints it.
 * ⛔ Reading a red on the 缺省 cell as "the pin needs updating" and writing the
 * new value in silently is the failure this const exists to prevent.
 */
const FLIP_TRIGGER = '缺省 = 保持，有旗 = 设置';

/**
 * The matrix. Each cell is a body the two contracts must answer identically —
 * absent (a state of its own, {@link FLIP_TRIGGER}), both booleans, and the
 * non-boolean spelling the door itself treats as absent (recorded on
 * `PackageInstallBodySchema`'s residual).
 */
const MATRIX: ReadonlyArray<{ name: string; enableOnInstall?: unknown }> = [
  { name: `absent — a state of its own, 「${FLIP_TRIGGER}」: no default resolves it` },
  { name: 'false — install present, not active', enableOnInstall: false },
  { name: 'true — the enable request, spelled', enableOnInstall: true },
  { name: "'false' — a string, refused by the declaration", enableOnInstall: 'false' },
  { name: 'null — refused by the declaration', enableOnInstall: null },
];

describe('#18605 — `enableOnInstall` has ONE authority', () => {
  describe('the authority: `PackageInstallRequestSchema`', () => {
    it(`leaves an absent key \`undefined\` — 「${FLIP_TRIGGER}」, so the door still sees the absence`, () => {
      const parsed = PackageInstallRequestSchema.parse({ manifest: MANIFEST });
      expect(parsed.enableOnInstall).toBeUndefined();
      // ⛔ Not merely "not `true`": the key must be ABSENT-shaped after the
      // parse, because the door's three-way read is `=== true` / `=== false` /
      // neither. Any other resolved value would be a fourth state.
      expect('enableOnInstall' in parsed).toBe(false);
    });

    it('carries `true` through — ⭐ re-read after the flip, not assumed to have survived it', () => {
      // The control in the other direction: making absence visible by making
      // the key mean nothing would be worse than the defect. This arm and the
      // `false` one below are what say the key still means something.
      const parsed = PackageInstallRequestSchema.parse({ manifest: MANIFEST, enableOnInstall: true });
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

    it('declares the key with the same type and the same OPTIONALITY, not merely the same name', () => {
      // ⭐ [#19273] This assertion used to read `typeof copyOnly === 'boolean'`,
      // which only held while a `.default(true)` was resolving the absence.
      // The flip-trigger removed that default from both declarations, so what
      // is pinned now is that neither one invents a value — and the boolean
      // half of the type is held by the spelled cells in the matrix above.
      const authorityOnly = PackageInstallRequestSchema.parse({ manifest: MANIFEST }).enableOnInstall;
      const copyOnly = InstallPackageRequestSchema.parse({ manifest: MANIFEST }).enableOnInstall;
      expect(copyOnly).toBeUndefined();
      expect(copyOnly).toBe(authorityOnly);

      // And the copy still carries a spelled value through, both ways — the
      // same control the authority gets above.
      expect(InstallPackageRequestSchema.parse({ manifest: MANIFEST, enableOnInstall: true }).enableOnInstall).toBe(true);
      expect(InstallPackageRequestSchema.parse({ manifest: MANIFEST, enableOnInstall: false }).enableOnInstall).toBe(false);
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

    it('declares `enableOnInstall` in its own right, and leaves an absent one `undefined` too', () => {
      // ⭐ [#19273] The 缺省 cell moved here as well, so the matrix reads as one
      // row per state across all three declarations. ⛔ Not a fold: what this
      // request means by 「enable」 is still one translation upstream of the
      // install door, which is what the two assertions above pin.
      const parsed = MarketplaceInstallRequestSchema.parse({ listingId: 'com.acme.crm' });
      expect(parsed.enableOnInstall).toBeUndefined();

      // Re-read in the other direction here too — the key still means
      // something on this request after the flip.
      expect(MarketplaceInstallRequestSchema.parse({ listingId: 'com.acme.crm', enableOnInstall: true }).enableOnInstall).toBe(true);
      expect(MarketplaceInstallRequestSchema.parse({ listingId: 'com.acme.crm', enableOnInstall: false }).enableOnInstall).toBe(false);
    });
  });
});
