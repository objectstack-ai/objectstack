// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of two exact reads, not of any key: ADR-0150 D4 (#32561) has
// the exact read (`?package=`) adopt the registry's binding of an undeclared
// row of an App's customization pair, so a row the registry binds to no
// package (it may customize either of two packages' members, red line 2) is
// no member of either package's address. No key is added, removed or
// re-shaped and no stored row changes shape, so no tombstone and no D2
// conversion: whose member a row customizes is the author's judgement. No
// relevance question: the move turns on what installed packages and stored
// pair rows hold, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'pair-row-exact-read-no-owner',
  surface:
    'The exact read of an email template member (GET /api/v1/meta/email_template/NAME?package=X&member=LOCALE, and '
    + 'the lists scoped to X) stored as a row of the App\'s customization pair (APP.custom) that declares no base '
    + '(no overrides.package), when another package of the App ships that locale as a bundle addition to X\'s '
    + 'template, or another App\'s shared pair stores an undeclared row of the same name',
  replacement:
    'Save the row declaring the package whose shipped locale it customizes: overrides.package naming the package '
    + 'of the App that ships that locale (the save door already prescribes this for a new row of a locale an '
    + 'installed package ships); ?package=THAT_PACKAGE then serves the row. A row of a locale no package ships '
    + 'stays readable at ?package=APP.custom.',
  reason:
    'The exact read used to count the holders after the registry had bound the row, so a bundle addition was no '
    + 'holder there and another App\'s pair was never read: ?package=X served an undeclared pair row of locale L '
    + 'although a package of the App ships L as an addition, so the row may as well customize that package\'s L. '
    + 'The registry binds such a row to no package (never a guess), and the exact read now adopts that binding, '
    + 'counted over the holders it serves: X\'s address answers X\'s own L (none), the addition\'s address its own '
    + 'L, and the pair\'s address the row. There is no mechanical rewrite: which package\'s locale a pair row '
    + 'customizes is a judgement about that row.',
  acceptanceCriteria:
    'For every row of an App\'s pair that declares no base (read them with '
    + 'GET /api/v1/meta/email_template/NAME?package=APP.custom) whose locale a package of the App ships as an '
    + 'addition: after saving it with overrides.package naming that package, '
    + 'GET /api/v1/meta/email_template/NAME?package=THAT_PACKAGE&member=LOCALE answers the row, and '
    + 'GET /api/v1/meta/email_template/NAME?package=X&member=LOCALE answers X\'s own locale or 404, never the row.',
};
