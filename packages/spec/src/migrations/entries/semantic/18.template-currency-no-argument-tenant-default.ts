// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A template `currency` hole with no argument stopped formatting in US
// dollars: it formats in the organization's default currency
// (`localization.currency`), and with none the render refuses the hole. No
// text changes, so there is nothing to rewrite; the question a conversion
// cannot answer is which currency the author meant.
export const entry: SemanticMigration = {
  id: 'template-currency-no-argument-tenant-default',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface: 'a template hole {{ amount | currency }} with no argument — email_template subject / bodyHtml / '
    + 'bodyText, flow text slots (notify, http, screen, end), action and bulk-action confirmText / successMessage',
  replacement: 'nothing, where the amount is in the organization\'s default currency (Setup → Localization, the '
    + '`localization.currency` setting). Where the amount is in one fixed currency, name it: '
    + '`{{ amount | currency:USD }}`',
  reason:
    'A behaviour change with no text to rewrite. The hole used to format in US dollars whatever currency the '
    + 'amount was in, a default nobody chose. It now formats in the organization\'s default currency, the code a '
    + 'currency field and a dashboard measure already display in, and when the organization has none the render '
    + 'refuses the hole by name: a mail or a notification is not sent (TEMPLATE_INVALID), a flow node fails, and '
    + 'an action\'s confirm or success sentence is shown as written. Not losslessly convertible because the '
    + 'question is intent, not text: writing `currency:USD` into every such hole would keep the old dollars and '
    + 'defeat the change for a non-dollar organization, and only the deployment knows which amounts were meant '
    + 'to be dollars. Authoring is unchanged: the hole is accepted at save and publish as before.',
  acceptanceCriteria:
    'With the organization\'s default currency set to CNY, a mail template whose subject is '
    + '`Due {{ amount | currency }}` renders `Due CN¥1,234.50` for an `en-US` row and amount 1234.5; with no '
    + 'default currency set, the same render fails with TEMPLATE_INVALID naming the hole and nothing is sent; '
    + '`{{ amount | currency:USD }}` renders `$1,234.50` either way.',
};
