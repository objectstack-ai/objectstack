// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0150 D4 with ADR-0126 Regime C, by type class: a package-less row (a
// stored row bound to no package, or its copy in the registry's bare slot) met
// at a holder's exact address answers one thing on every read and in every
// hydration state. A narrowing of answers, not of any key: no schema key moves
// and no stored row changes shape, so no tombstone and no D2 conversion. What
// an upgrading author owes is to say which package the row belongs to, which
// only the author knows. No relevance question: the moved answers turn on
// what two installed packages hold, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'package-less-row-exact-address-by-type-class',
  surface:
    'A package-less row of a name a package ships, read at a holder\'s exact address '
    + '(GET /api/v1/meta/TYPE/NAME?package=ID and the namespace address /api/v1/meta/TYPE/NS/NAME): the active '
    + 'read, the strict draft read (?state=draft), the draft preview, the layered read (?layers=true) and its draft '
    + 'layer, and the list scoped to a package with drafts previewed. (1) An overlay type (email_template, '
    + 'dashboard, report): a package-less draft of a name two or more packages hold. (2) A sealed managed type '
    + '(artifact-backed with no overlay channel: action, agent, page, hook, job, queue, sharing_rule, '
    + 'assignment_rule and the like): any package-less row of a name a package ships. Whether the change moves to a '
    + 'declared override turns on the type: only flow, action, page, app, dataset, doc, book and mapping have one',
  replacement:
    'Delete the package-less row FIRST (DELETE /api/v1/meta/TYPE/NAME naming no package; ?state=draft for a '
    + 'draft), then save the change where it belongs: a package-less delete addresses the one package the name\'s '
    + 'rows are bound to, so run after the save it removes the change just saved and leaves the package-less row. '
    + 'For (1), save the draft under the package it customizes: ?package=ID when the holder is a writable '
    + '(authored) package; for a code package, whose own address refuses the save 403 NOT_OVERRIDABLE naming its '
    + 'pair, in the holder\'s paired .custom package (?package=ID.custom with overrides: { package: ID, basedOn: '
    + 'VERSION }). For (2), what the change becomes depends on whether the type has a declared override channel '
    + '(ADR-0146). (2a) flow and action (under ADR-0146 D9\'s conditions), page, app, dataset, doc, book and '
    + 'mapping: author the change as a declared override in the holder\'s paired .custom package, after deleting the '
    + 'package-less row. (2b) every other sealed type (hook, job, queue, sharing_rule, assignment_rule, agent, '
    + 'skill, api and the like) has no override channel: delete the package-less row, and ship the change as a new '
    + 'version of the holding package\'s source, or keep it as an item of its own under a name no package ships (an '
    + 'environment action bound to an object neither holder binds included). A package-less overlay row of a name '
    + 'one package holds is that holder\'s customization and is served as before',
  reason:
    'A package-less row of an overlay type is a holder\'s customization that cannot say which holder when two '
    + 'packages hold the name (ADR-0150 D4), so each holder\'s exact read refuses it 409 RESOURCE_CONFLICT naming '
    + 'every holder. The active read already did; the draft exits served the draft at both addresses and now '
    + 'refuse it too. A sealed type\'s package-less row customizes nothing (ADR-0126 Regime C), so it is declined '
    + 'and the address serves its holder\'s own shipped item, with one holder or two. The plain read already '
    + 'declined the stored row; a registry copy of it (after a list read or the boot load hydrated it) was served '
    + 'or refused 409, its draft was served, and the layered read reported it or refused 409. The read-side '
    + 'hydrator no longer lays a package-less row into the first holder\'s slot under that holder\'s envelope. '
    + 'Nothing is rewritten: which package a row belongs to is a judgement only its author can make. Measured when '
    + 'the change landed: no first-party composition has two packages holding one name with a package-less row.',
  acceptanceCriteria:
    'For every package-less draft of an email_template, dashboard or report whose name two installed packages '
    + 'hold, the package-less draft is deleted and the draft re-saved under the package it customizes: '
    + '?package=ID&state=draft answers it for a writable holder, ?package=ID.custom&state=draft for a code package '
    + '(whose own ?package=ID&state=draft answers no draft), and no holder\'s draft read answers 409 naming both. For every package-less stored row '
    + 'of a sealed type whose name a package ships, no package-less row of the name remains, and: for a type of '
    + '(2a), the change lives in a declared override of the holder\'s .custom package and ?package=ID answers the '
    + 'override, before and after a reload; for a type of (2b), ?package=ID answers the holder\'s own shipped item '
    + 'at the version that carries the change, or the change answers under its own name, which no package ships.',
};
