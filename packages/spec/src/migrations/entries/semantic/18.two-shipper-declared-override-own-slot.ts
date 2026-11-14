// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0150 D4 at the served-override reads: two namespaces' packages that ship
// one name are two items, each customized by its own pair's declared override,
// whichever package registered first. A change of which stored row a read
// serves, not of any key: no schema key moves and no stored row changes shape,
// so no tombstone and no D2 conversion. No relevance question: the moved answer
// turns on two installed packages shipping one name, which no question over one
// stack can name.
export const entry: SemanticMigration = {
  id: 'two-shipper-declared-override-own-slot',
  surface:
    'A name of an overridable type that two installed packages of two namespaces both ship, with a declared '
    + '.custom override (overrides: { package: ID, basedOn }) of one or both: for an action, the env-wide list '
    + '(GET /api/v1/meta/action), the execution view the automation engine arms from and, when ONE package declares '
    + 'an override, the registry\'s item at each package (with both overridden, the registry item keeps one bare slot '
    + 'per name and is not covered here); for a page, app, dataset, doc, book or mapping, the reads at the second-registered package\'s '
    + 'address (GET /api/v1/meta/TYPE/NAME?package=ID, the layered read), the lists and the boot report '
    + 'metadata_sealed_overlay_unserved; for every type, the env-wide list (GET /api/v1/meta/TYPE naming no package)',
  replacement:
    'Nothing to rewrite: keep each customization as the declared override of the package it customizes, in that '
    + 'package\'s own paired .custom package (PUT /api/v1/meta/TYPE/NAME?package=ID.custom with overrides: '
    + '{ package: ID, basedOn: VERSION }). Read each package\'s item by its package (?package=ID) or from its own '
    + 'entry of the env-wide list, whose _packageId names the package it is',
  reason:
    'A declared override binds to the package it names (ADR-0150 D4), never to whichever package shipped the name '
    + 'first. Before, an action override of the second-registered package was registered under the first package\'s '
    + 'envelope, so the first package\'s slot listed and executed it in place of its own shipped action; the six '
    + 'sealed types judged the declaration against the first-registered package alone, so the second package\'s '
    + 'override was declined at its own address and the boot report prescribed deleting it; and the env-wide list of '
    + 'every other type listed the override a second time under the first package. Measured when the change '
    + 'landed: no first-party composition has two packages shipping one name with a declared override.',
  acceptanceCriteria:
    'For every name two installed packages ship, with a declared override in one package\'s .custom pair: '
    + 'GET /api/v1/meta/TYPE/NAME?package=ID answers that override at the overridden package and the other package\'s '
    + 'own item at the other, in either registration order; the env-wide list holds exactly one entry per package, '
    + 'each under its own _packageId, plus, for a bundle (an email template), a pair\'s added member the package does '
    + 'not ship, kept as a further entry on purpose; and the boot report metadata_sealed_overlay_unserved names no declared override.',
};
