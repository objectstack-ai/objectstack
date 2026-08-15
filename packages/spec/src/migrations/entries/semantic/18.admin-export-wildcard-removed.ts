// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'admin-export-wildcard-removed',
  surface:
    'the SHIPPED platform admin permission sets `admin_full_access`, `organization_admin` and '
    + 'the derived `organization_admin_no_bypass` — their `objects["*"].allowExport = true` '
    + 'wildcard grant (REMOVED; the rest of the wildcard is unchanged)',
  replacement:
    'an explicit `allowExport: true` on the object entries of an APP-authored permission set '
    + 'held by the principals meant to keep exporting. Nothing replaces the grant in the '
    + 'platform sets themselves',
  reason:
    'A capability NARROWING of a published set, and — like `export-axis-opt-in`, whose 17.0 '
    + 'story this completes — one no gate can announce: the metadata is unchanged and still '
    + 'parses, the shipped sets are re-seeded on upgrade, and the only observable is that an '
    + 'export which returned 200 now returns 403 `EXPORT_NOT_PERMITTED`. `export-axis-opt-in` '
    + 'told upgraders that "package-shipped sets are re-seeded on upgrade, so the built-ins '
    + 'are handled — `admin_full_access` and `organization_admin` now carry the grant '
    + 'explicitly"; from this major they deliberately do NOT, so a deployment that read that '
    + 'sentence and left its admins to the built-ins must now act. What the wildcard did, '
    + 'measured on 17.0.0 GA across 40 export probes: an org owner exported three objects on '
    + 'which NO app permission set granted export, 200 with full rows, and the app had no way '
    + 'to refuse — editing a code-package set answers `403 [not_overridable]`, and the org '
    + 'admin holds no app-authored set in which to write the per-object `false` that would '
    + 'have won. So an application could declare an object exportable by nobody, ship, and be '
    + 'silently wrong on an exfiltration boundary — declared ≠ enforced, on the axis where a '
    + 'silent gap costs the most. This is #5491 applied to export: that change removed '
    + '`member_default`\'s CRUD wildcard because a wildcard in a set every principal resolves '
    + 'is not a default but a floor nobody can get under; the export wildcard survived by '
    + 'omission rather than by decision, one tier up. It cannot be mechanically converted, in '
    + 'either direction: re-granting `allowExport` wherever an admin holds a set would restore '
    + 'today\'s behaviour and defeat the entire point, and leaving it withheld may revoke '
    + 'export an operator legitimately wants. WHICH principals may take a bulk copy is the '
    + 'segregation-of-duties judgement the axis exists to make explicit, and it belongs to the '
    + 'operator. Note the boundary this does NOT move: the export gate itself is unchanged and '
    + 'was never the defect (controls C1–C3 of the same run show it enforcing exactly), '
    + 'specific-over-wildcard precedence is unchanged, `allowExport` on a `"*"` entry remains a '
    + 'supported authoring shape in an app\'s OWN sets, and READ is untouched — an admin still '
    + 'sees every record they saw before. ADR-0087, maintainer ruling 2026-08-15, #8681.',
  acceptanceCriteria:
    'For every principal whose ADMIN export you rely on, the grant is now authored where you '
    + 'control it: an app/environment permission set held by that principal names each object '
    + 'they must export and carries `allowExport: true` on it. Verify BEHAVIOURALLY — nothing '
    + 'fails at parse time, and a re-seed silently replaces the old built-ins: sign in as an '
    + 'org owner or platform admin and call `GET /api/v1/data/<object>/export`, confirming 200 '
    + 'where export is intended and 403 `EXPORT_NOT_PERMITTED` where it is not. ⚠️ Silence is '
    + 'not success: a deployment that upgrades without editing anything is VALID metadata '
    + 'whose administrators have quietly lost export on every object no app set grants, and '
    + 'the first sign will be a support report rather than an error. The reverse reading is '
    + 'worth one pass too — an object your app declares exportable by nobody is now genuinely '
    + 'exportable by nobody, which is the point of the change; confirm that is what you want '
    + 'before granting it back.',
};
