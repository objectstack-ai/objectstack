// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22934. An accept-set narrowing of the stack aggregate: two entries of one
// of 27 named collections that the runtime registers under one identity are
// refused by the cross-reference pass — the batch sibling of the duplicate
// action-key refusal and of the `functions` array's duplicate-name refusal. No
// D2 conversion: which entry keeps the identity, and what the other one
// becomes, is the author's call.
export const entry: SemanticMigration = {
  id: 'stack-collection-duplicate-entry-refused',
  surface:
    'stack.objects, datasources, pages, dashboards, reports, datasets, flows, jobs, emailTemplates, books, '
    + 'positions, permissions, capabilities, sharingRules, webhooks, hooks, mappings, analyticsCubes, '
    + 'connectors, picklists, docs, tools, skills, views, apis, apps and objectExtensions — two or more '
    + "entries of one collection under one identity, e.g. pages: [{ name: 'home', ... }, { name: 'home', ... }]",
  replacement:
    'One entry per identity in each collection. The identity is the entry name, the name and locale '
    + 'for emailTemplates (one name across several locales is an i18n bundle; an entry with no locale '
    + 'counts as en-US), the extended object (extend) for objectExtensions, and for views the object a '
    + 'container binds to (object, else '
    + 'list.data.object, else form.data.object, else its name). Rename one of the colliding entries (and '
    + 'every reference that meant it), or merge them into a single entry: one container per object for '
    + 'views, one extension per target object for objectExtensions, and a name of its own for each apis '
    + 'endpoint. Distinct identities, an email-template i18n bundle, the map form under distinct keys, '
    + 'and the same name reused by another package are unchanged.',
  reason:
    'The runtime registers each of these collections under one identity per entry, and a stack could '
    + 'author two entries under one identity with nothing refusing it: defineStack and objectstack '
    + 'validate accepted the pair (exit 0, valid true), and the boot then lost or split it silently. '
    + 'Measured on a source boot and on objectstack build followed by an artifact-backed boot: 23 '
    + 'collections and objectExtensions kept only the LAST entry on both paths, with no notice at the '
    + 'default log level; for datasources the metadata described the last entry while the driver '
    + 'connected with the first one\'s configuration; for hooks the metadata listed one hook while both '
    + 'handlers were bound and ran; and for docs objectstack validate and objectstack build refused the '
    + 'pair while a source boot kept the last. The stack aggregate now refuses the pair, in the same '
    + 'cross-reference envelope as a duplicate action key, with one finding per collision naming the '
    + 'collection, the identity and every index. Not convertible: which entry keeps the identity is a '
    + 'fact only the author holds.',
  acceptanceCriteria:
    'os validate and os build load the stack without a STACK_CROSS_REFERENCE_INVALID finding of the form '
    + '"X is declared twice in KEY: stack.KEY[i] and stack.KEY[j]". After renaming or merging, check that '
    + 'what the runtime now serves is the entry you meant: the boot used to keep the last entry (and, for '
    + 'datasources, connect the first), so the behaviour you observed may have come from a different entry '
    + 'than the one you keep.',
};
