// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of one registration, not of any key: ADR-0150 D4 (#32408) binds
// a row of an App's customization pair by the exact read's owner rule on every
// reader of the registry's overlay slot, so a row of the App's pair that
// declares another package of the App (`overrides.package`, ADR-0146 D2) is
// that package's member, no longer the App's. The bundle-addition rule of the
// bare-name gate (ADR-0150 D3) reads those members, so a later package whose
// only locale of an email template is that row's locale is now an addition to
// the App's template. No key is added, removed or re-shaped and no stored row
// changes shape, so no tombstone and no D2 conversion: which locale a package
// ships is the author's judgement. No relevance question: the refusal turns on
// what installed packages and a stored pair row hold, which no question over
// one stack can name.
export const entry: SemanticMigration = {
  id: 'pair-row-locale-addition-refused',
  surface:
    'The bare-name gate of a bundled type (email_template) once the holders are sealed (an install, upgrade, hot '
    + 'reload or late item registration): a package whose only members of a template name are locales the App ships '
    + 'none of, while the App\'s customization pair (APP.custom) stores a row of that locale declaring another '
    + 'package of the App as the base it customizes (overrides.package)',
  replacement:
    'Ship a locale of the template that the App ships too, so the package holds the name beside the App instead of '
    + 'adding to the App\'s template; or rename the template in the package being installed.',
  reason:
    'Before ADR-0150 D4 the registry read a row of an App\'s pair by the pair\'s base only, whatever the row '
    + 'declared, so a pair row of locale L declaring package X counted as the App\'s own member of the template. A '
    + 'later package shipping only L then shared a member with the App and was admitted beside it. The registry now '
    + 'binds the row as the exact read (?package=) already did: to X, the package it declares. The App ships no L, '
    + 'so the later package\'s L is an addition to the App\'s template, and the gate refuses it 422 '
    + 'NAMESPACE_CONFLICT naming the App. There is no mechanical rewrite: which locale a package ships, and which '
    + 'base a pair row customizes, is a judgement about that package and that row.',
  acceptanceCriteria:
    'For every email template a package installed after the App holds only through locales the App does not ship, '
    + 'read the App\'s pair rows of that name (GET /api/v1/meta/email_template/NAME?package=APP.custom) and their '
    + 'overrides.package. Each package then installs with no NAMESPACE_CONFLICT naming the App, and '
    + 'GET /api/v1/meta/email_template/NAME?package=X answers each declared row on the package it declares.',
};
