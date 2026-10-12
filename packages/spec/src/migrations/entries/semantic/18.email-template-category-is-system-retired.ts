// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22876 — ADR-0049 enforce-or-remove — the D3 entry of the
// `email-template-category-is-system-removed` family (one D3 entry per
// retirement family, even when D2 is lossless). Registered keys:
// `system/EmailTemplateDefinition:category` and
// `system/EmailTemplateDefinition:isSystem`. The strip changes no send; what it
// cannot decide is whether something the author built read either key.
export const entry: SemanticMigration = {
  id: 'email-template-category-is-system-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    'emailTemplates[].category / emailTemplates[].isSystem — an email template\'s grouping and its built-in flag',
  replacement:
    'Nothing: delete both keys. A template is found by its name, so group templates with a dotted '
    + 'namespace prefix (auth.password_reset, crm.welcome). A built-in template is a code package\'s '
    + 'declaration: a Studio save overrides it for the environment, and discarding that save restores '
    + 'the package\'s copy.',
  reason:
    'The D2 conversion `email-template-category-is-system-removed` deletes `category` and `isSystem` '
    + 'from every template, and the delete is lossless: nothing in the platform read either key after '
    + 'templates stopped being copied into `sys_email_template` rows, so every send renders and '
    + 'delivers as before. What the conversion cannot check is whether something the author built read '
    + 'them — a report, a script or an integration that filtered templates by `category`, or treated '
    + '`isSystem: true` as protection against deletion. No door ever refused that deletion.',
  acceptanceCriteria:
    'No email template carries `category` or `isSystem`, and the parse refuses either with the '
    + 'prescription. Every template sends as it did before the upgrade. Nothing the author maintains '
    + 'reads either key, or relies on `isSystem` to keep a template from being deleted.',
};
