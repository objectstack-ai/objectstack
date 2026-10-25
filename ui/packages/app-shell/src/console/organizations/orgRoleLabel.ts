/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ONE display name per membership role, for every organization screen
 * (objectui#4474).
 *
 * ## What was actually drifting
 *
 * The card describes "two hand-authored lists that disagree" — `Owner`/`Member`
 * badges beside a 所有者/成员 dropdown. Measured on `origin/main`, the shape is one
 * step worse than that: there is only ONE authored list,
 * `ORG_ROLE_LABELS` in `@object-ui/auth`, and the dropdown and the role-change
 * menu both read it correctly. The badges read **nothing** — they render
 * `member.role` / `inv.role`, the raw server identifier, under a CSS
 * `capitalize` that turns `owner` into `Owner` and passes for a label.
 *
 * So the two sides never disagreed about a *translation*; one side was not
 * translating at all, and CSS made that invisible in English. Collapsing them
 * means routing every role display through this module, which is the map's only
 * consumer-facing entry point.
 *
 * ## Why the keys resolved to English before this issue
 *
 * `ORG_ROLE_LABELS` names four i18n keys (`organization.roles.*`) that **no pack
 * defined** — so every consumer fell through to its inline English
 * `defaultValue`, including the dropdown the card reports as already Chinese.
 * `scripts/check-i18n-call-site-keys.mjs` is exactly the gate for that class and
 * it paid off 258 of them, but it scans string LITERALS and these are reached as
 * `ORG_ROLE_LABELS[r].key` — a variable. The packs now carry the four keys;
 * `packages/app-shell/src/console/organizations/__tests__/org-i18n-holdouts-4474.test.tsx`
 * is the standing replacement for the coverage the indirection costs.
 *
 * ## Unknown roles degrade, they never blank
 *
 * The membership vocabulary is closed and framework-owned (ADR-0108 / objectstack-ai/objectstack#3723), so
 * a role outside the four is not supposed to exist. `member.role` is still a
 * server string, and the console's job when it does not recognize one is to show
 * what the server said — the same "prefer mapped, degrade to verbatim" rule the
 * error mapping next door follows. Rendering an empty badge, or guessing, would
 * destroy the only information an operator has about that member.
 *
 * Deliberately NOT handled: the comma-joined form (`owner,admin`) that
 * `orgRoleGrade` splits. That split exists to compute a fail-closed authority
 * GRADE, which is a different question from what to print; a joined value here
 * falls to the verbatim leg and shows `owner,admin`, which is honest. Inventing
 * a localized list-joiner for a shape this surface has never been measured
 * producing would be building vocabulary ahead of the need.
 */

import { ORG_ROLE_LABELS } from '@object-ui/auth';
import type { OrgRole } from '@object-ui/auth';
// One authority for `OrgTranslate` (objectui#6349): `orgErrorMessage.ts`
// declares the translate-function shape both organization helpers take, and
// this module re-exports it so an import from `./orgRoleLabel.js` keeps
// resolving to the same type. A re-export, not a second declaration.
import type { OrgTranslate } from './orgErrorMessage.js';

export type { OrgTranslate } from './orgErrorMessage.js';

/** True when `role` is one of the four framework-owned membership roles. */
function isKnownRole(role: string): role is OrgRole {
  return Object.prototype.hasOwnProperty.call(ORG_ROLE_LABELS, role);
}

/**
 * Resolve a role identifier to its display name in the active locale.
 *
 * @param role - the identifier as the SERVER spells it (`sys_member.role`)
 * @param t    - the active translator
 * @returns the localized name, or the raw identifier when it is not a known role
 */
export function resolveOrgRoleLabel(role: unknown, t: OrgTranslate): string {
  if (typeof role !== 'string') return '';
  const trimmed = role.trim();
  if (!trimmed) return '';
  if (!isKnownRole(trimmed)) return trimmed;
  const label = ORG_ROLE_LABELS[trimmed];
  return t(label.key, { defaultValue: label.defaultValue });
}
