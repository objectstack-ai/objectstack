// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D3/D4 — a runtime narrowing with an authorable key ADDED: the
// position -> permission-set binding moves from the junction rows onto the
// position definition. Registered because an app or a deployment that bound
// sets to positions with rows must name them on the definitions instead.
export const entry: SemanticMigration = {
  id: 'position-permission-sets-declared',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the sys_position_permission_set rows that bound permission sets to a position — written by an '
    + 'app binder at boot, by Setup on a position page, or by confirming an audience-binding suggestion — '
    + 'which the authorization resolver no longer reads',
  replacement:
    'name the sets in `permissionSets` on the position definition, for example '
    + '`definePosition({ name: \'sales_rep\', label: \'Sales Representative\', permissionSets: [\'crm_sales_user\'] })`. '
    + 'An app declares it in code; a deployment saves the definition through the metadata door '
    + '(`PUT /api/v1/meta/position/:name`, a platform administrator). Rows already stored are converted by the '
    + 'ADR-0131 upgrade ceremony, which applies `convertPositionBindingRows` (`@objectstack/core`)',
  reason:
    'ADR-0131 D3/D4: the security catalog has one home, the environment registry, and every reference to a '
    + 'catalog item is a name resolved there. A position now grants the sets its definition names and the '
    + 'sets resolve by name, bodies included, so a binding that exists only as a junction row grants nothing. '
    + 'The conversion of stored rows is data, not a metadata rewrite: organizations that bound different '
    + 'sets to one position name are reported conflicting and never merged (D10 fate 4), so no chain step '
    + 'can apply it on its own. Under a wall a position or set an organization authored in Setup has no '
    + 'definition at all and stops granting (ruled: such a row is not promoted); a platform administrator re-creates it as '
    + 'environment metadata under the same name to keep it. ADR-0087.',
  acceptanceCriteria:
    'Every position whose holders should hold a permission set names that set in `permissionSets` on its '
    + 'definition (`GET /api/v1/meta/position/:name` shows it), and a holder of the position resolves the '
    + 'set: it is listed in the `permissions` of the holder\'s authorization context. A junction row with no '
    + 'matching `permissionSets` entry grants nothing.',
};
