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
// one stack can name. The same entry names the gate's second narrowing, the
// same remedy: a package-less row is a sole holder's member only while that
// holder is the one package holding the name, and the gate now counts the
// arriving package as the cold boot's seal does (#32408, delta review N1).
export const entry: SemanticMigration = {
  id: 'pair-row-locale-addition-refused',
  surface:
    'The bare-name gate of a bundled type (email_template) once the holders are sealed (an install, upgrade, hot '
    + 'reload or late item registration): a package whose only members of a template name are locales the App ships '
    + 'none of, while the App\'s customization pair (APP.custom) stores a row of that locale declaring another '
    + 'package of the App as the base it customizes (overrides.package); and a package of another namespace whose '
    + 'dependencies reach a package X that holds the template alone, whose only members of it are a locale X ships '
    + 'none of, while a package-less row of that locale (a legacy overlay in the environment\'s slot) customizes '
    + 'X\'s template',
  replacement:
    'Ship a locale of the template that the holder ships too (the App, or X for the package-less row), so the '
    + 'package holds the name beside that holder instead of adding to its template: declared in the manifest, or, '
    + 'for members registered one by one, that shared locale first; or rename the template in the package being '
    + 'installed.',
  reason:
    'Before ADR-0150 D4 the registry read a row of an App\'s pair by the pair\'s base only, whatever the row '
    + 'declared, so a pair row of locale L declaring package X counted as the App\'s own member of the template. A '
    + 'later package shipping only L then shared a member with the App and was admitted beside it. The registry now '
    + 'binds the row as the exact read (?package=) already did: to X, the package it declares. The App ships no L, '
    + 'so the later package\'s L is an addition to the App\'s template, and the gate refuses it 422 '
    + 'NAMESPACE_CONFLICT naming the App. A package-less row of locale L over a name X alone holds is X\'s member '
    + 'only while X is the one package holding the name; the gate now reads the arriving package as registered, as '
    + 'the cold boot\'s seal reads it, so a package on X shipping only L makes two holders, the row is neither\'s, '
    + 'and the package\'s L is an addition to X\'s template, refused 422 NAMESPACE_CONFLICT naming X (it was '
    + 'admitted, after which the row bound to neither package and the seal reported it). There is no mechanical '
    + 'rewrite: which locale a package ships, and which base a pair row customizes, is a judgement about that package '
    + 'and that row.',
  acceptanceCriteria:
    'For every email template a package installed after the App holds only through locales the App does not ship, '
    + 'read the App\'s pair rows of that name (GET /api/v1/meta/email_template/NAME?package=APP.custom) and their '
    + 'overrides.package. Each package then installs with no NAMESPACE_CONFLICT naming the App, and '
    + 'GET /api/v1/meta/email_template/NAME?package=X answers each declared row on the package it declares. Every '
    + 'package of another namespace whose only members of a template a package X holds alone are locales X ships '
    + 'none of either ships one X ships or renames the template, and installs with no NAMESPACE_CONFLICT naming X.',
};
