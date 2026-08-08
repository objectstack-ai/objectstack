// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Tombstone for four dead `apps.setup.navigation` translation keys (#6660).
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
// contributed only when an external IdP is wired). Making that gate
// union-aware is tracked as #6659.
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
