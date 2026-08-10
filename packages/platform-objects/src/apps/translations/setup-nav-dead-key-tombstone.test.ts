// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Tombstone for four dead `apps.setup.navigation` translation keys (#6660), and
// its converse: the labels of conditionally-contributed entries, which must
// STAY (#6659).
//
// ---------------------------------------------------------------------------
// Why a hard-coded id list instead of the general reverse direction
// ---------------------------------------------------------------------------
// `app-nav-translation-parity.test.ts` asserts the reverse direction for Studio
// ("a translation for an id the app no longer declares is dead weight that
// reads as coverage") by walking `STUDIO_APP.navigation`. Setup cannot be
// walked that way: it is a shell of empty group anchors (ADR-0029 D7) and every
// entry arrives at RUNTIME, so this file has nothing to diff against — which is
// exactly why that file's header says a Setup case there "has to boot
// something", and why `pnpm check:app-nav-i18n` (which does boot) still refuses
// the reverse direction: from one composition a dead key and a
// conditionally-contributed key are indistinguishable (`nav_sso_providers` is
// contributed only when an external IdP is wired). Teaching that gate to
// enumerate conditional contributions — a union-aware gate — was considered and
// deliberately NOT built (#6659's triage): it is a separate maintainer-facing
// call, not a prerequisite for labelling the ids it cannot see.
//
// This file makes no general claim. It pins exactly four ids that were checked
// ONE BY ONE against a repo-wide grep — `id: '<key>'` returned zero hits for
// each of them on `61282f906`, against a control probe (`nav_webhooks`) that
// returned five — and each of which has a recorded reason to be gone:
//
//   nav_approval_processes  the process engine was retired in favour of the
//                           approval flow node (#1408, ADR-0019 P4/P5)
//   nav_verifications       `sys_verification` omits `list` from `apiMethods`
//   nav_device_codes        `sys_device_code` likewise — both are sensitive,
//                           ephemeral secrets, so a browse entry could only
//                           ever render "failed to load" (#2266, and the
//                           comment that records it in
//                           `setup-nav.contributions.ts`)
//   nav_metadata            moved to Studio as `nav_metadata_directory` when
//                           the Studio app was split out (482eb67cc)
//
// ---------------------------------------------------------------------------
// What to do when this test goes red
// ---------------------------------------------------------------------------
// It goes red on exactly one event: one of the four ids comes back. That is not
// automatically wrong — re-adding `nav_verifications` or `nav_device_codes` is a
// deliberate security decision (it requires enabling `list` on the object
// first), and `nav_approval_processes` could return with a new owner. The rule
// is the ORDER: the declaring nav item comes back first, the label second, and
// the id's line is deleted from `DEAD_SETUP_NAV_IDS` in that same commit. A
// label with no declaring nav item is what this tombstone exists to refuse.

import { describe, it, expect } from 'vitest';
import { SETUP_NAV_CONTRIBUTIONS } from '../setup-nav.contributions.js';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';
import { jaJP } from './ja-JP.js';
import { esES } from './es-ES.js';

const LOCALES = { en, 'zh-CN': zhCN, 'ja-JP': jaJP, 'es-ES': esES } as const;

/** Removed Setup nav ids. Delete a line here only together with its nav item. */
const DEAD_SETUP_NAV_IDS = [
  'nav_approval_processes',
  'nav_device_codes',
  'nav_metadata',
  'nav_verifications',
] as const;

describe('removed Setup nav ids stay removed (#6660)', () => {
  for (const [locale, data] of Object.entries(LOCALES)) {
    it(`${locale} carries no label for a removed Setup nav id`, () => {
      const nav = (data.apps?.setup?.navigation ?? {}) as Record<string, { label?: string }>;
      expect(
        DEAD_SETUP_NAV_IDS.filter((id) => id in nav),
        'apps.setup.navigation keys with no declaring nav item — see this file header',
      ).toEqual([]);
    });
  }

  // The other half of the same fact, on the one Setup contributor this package
  // owns. Keeping it here means a re-added nav item cannot quietly restore a
  // label without this ledger being read: both assertions go red together.
  it('SETUP_NAV_CONTRIBUTIONS declares none of them', () => {
    const declared = new Set<string>();
    const walk = (items: unknown[]): void => {
      for (const raw of items) {
        const item = raw as { id?: string; children?: unknown[] };
        if (item?.id) declared.add(item.id);
        if (Array.isArray(item?.children)) walk(item.children);
      }
    };
    for (const contribution of SETUP_NAV_CONTRIBUTIONS) walk(contribution.items);

    // Control: the walk really reads this array, so an empty `declared` cannot
    // pass the assertion below by vacuity.
    expect(declared.has('nav_users'), 'nav_users is contributed here').toBe(true);
    expect(DEAD_SETUP_NAV_IDS.filter((id) => declared.has(id))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The converse case (#6659): a label that must STAY although no boot sees it
// ---------------------------------------------------------------------------
// `pnpm check:app-nav-i18n` boots the real composition and asserts every MERGED
// Setup nav id carries a label in every locale. That is the right shape for the
// eleven contributors whose entries always merge — and it is structurally blind
// to the ones that do not. `@objectstack/plugin-auth` spreads its
// `navigationContributions` in only when `authManager.isSsoWired()` is true
// (`OS_SSO_ENABLED` self-host, or the cloud per-env `planAllowsSso`), so in the
// composition that gate boots, `nav_sso_providers` is never contributed, never
// merged, and therefore never judged. It had no label in ANY of the four
// locales while that gate reported OK, and a deployment with an external IdP
// wired rendered `SSO Providers` in English inside an otherwise translated menu.
//
// So this case is a hand-kept list, exactly like `DEAD_SETUP_NAV_IDS` above and
// for the same reason: one composition cannot decide the question, so a human
// decided it per id. It is deliberately NOT a general union-aware gate — that
// was ruled a separate maintainer-facing call (#6659's triage) and is not built.
//
// Bound worth stating: this file asserts only the LABEL half. The declaring
// contribution lives in `@objectstack/plugin-auth`, which depends on this
// package and so cannot be imported from here — the same import direction that
// puts `check:app-nav-i18n` in `packages/cli`. A grep is what confirms the
// declaring side; on `ea1d9165d` it sits at `auth-plugin.ts:552`.
//
// What to do when this test goes red: it goes red when a label is dropped, or
// when a locale is added to the bundle without translating this id. Both are
// bugs. If the CONTRIBUTION is ever retired, this list loses its entry in the
// same commit that removes the nav item, and the id moves up to
// `DEAD_SETUP_NAV_IDS` — the two lists are the two halves of one ledger.
const CONDITIONAL_SETUP_NAV_IDS = ['nav_sso_providers'] as const;

describe('conditionally-contributed Setup nav ids stay labelled (#6659)', () => {
  for (const [locale, data] of Object.entries(LOCALES)) {
    it(`${locale} carries a label for every conditionally-contributed Setup nav id`, () => {
      const nav = (data.apps?.setup?.navigation ?? {}) as Record<string, { label?: string }>;

      // Control: the subtree really resolved, so a missing/renamed
      // `apps.setup.navigation` cannot make the assertion below pass by vacuity
      // (it would instead report every id as unlabelled — which is the point).
      expect(nav.nav_api_keys?.label, 'nav_api_keys anchors this subtree').toBeTruthy();

      expect(
        CONDITIONAL_SETUP_NAV_IDS.filter((id) => !nav[id]?.label),
        'Setup nav ids with no label — no boot-time gate can see these; see this file header',
      ).toEqual([]);
    });
  }
});
