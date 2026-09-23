// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The one key this close DECLARES rather than refuses is `dependsOn`, so an author
// who wrote it keeps working and now has a contract saying so. Everything else
// undeclared becomes a parse error. Registered as a structured TODO (ADR-0087 D3)
// rather than a conversion (D2) for the reason the majors-15/16/17 strictness
// entries give: an arbitrary unknown key has no mapping target, and deleting it
// automatically is the silent data loss ADR-0078 bans.
export const entry: SemanticMigration = {
  id: 'ui-bulk-action-param-unknown-keys-refused',
  surface:
    'a list view\'s `bulkActionDefs[].params[]` entry (`BulkActionParamSchema`) — undeclared '
    + 'keys, which this shape accepted and forwarded while it was `.passthrough()`',
  replacement:
    'the declared shape, now closed to match its single-record twin `ActionParamSchema`: '
    + '`{ name, type }` plus `label`, `help`, `required`, `default`, `options`, `object`, '
    + '`labelField`, `multiple`, `placeholder` and — new in this release — `dependsOn`. Every '
    + 'rejection names the surface, echoes the offending key and carries a rename or a '
    + 'prescription: the action-param spellings rename onto this surface\'s words (`helpText` → '
    + '`help`, `defaultValue` → `default`, `reference` → `object`, `displayField` → '
    + '`labelField`); the keys that belong one layer out are pointed there (`visible` and a '
    + 'capability gate belong on the DEF, `visibleWhen` belongs on an `options[]` entry, '
    + '`field` / `objectOverride` / `carryOver` / `defaultFromRow` / `requiresFeature` are '
    + 'field-backed ACTION-param contracts the bulk surface does not implement); and the '
    + 'widget-config family (`min`, `max`, `step`, `precision`, `scale`, `rows`, `accept`, '
    + '`maxSize`, and the picker knobs `lookupFilters` / `lookupColumns` / `lookupPageSize` / '
    + '`descriptionField` / `picker` / `subtitle` / `avatarField` / `idField` / `allowCreate`) '
    + 'is answered with one prescription naming `FieldSchema` as the shape those keys are real '
    + 'on. `dependsOn` needs NO edit — it is declared, in the same shape the field-level key '
    + 'takes (`[\'parent\']`, or `[{ field, param }]` when the remote filter key differs).',
  reason:
    'The accept was a NULL READING, and that is what makes this a contract fix rather than a '
    + 'preference. Measured against installed spec 17.4.0, three parses per schema in one '
    + 'process: `BulkActionParamSchema` accepted `zzz_nonsense_key_that_no_producer_emits_8755` '
    + 'in the SAME RUN that it accepted `dependsOn`, while `ActionParamSchema` one surface over '
    + 'refused both with `unrecognized_keys`. A shape that examines nothing cannot license '
    + 'anything — so "the bulk schema accepts it" was never evidence a key was authorable, and '
    + 'every misspelling and every invented key shipped silently. Not losslessly convertible '
    + 'for the reason the majors-15/16/17 strictness entries give: an arbitrary unknown key has '
    + 'no mapping target and auto-deleting it would be the silent data loss ADR-0078 bans, so '
    + 'each occurrence needs an author\'s decision. ⚠️ Two halves of this are worth knowing '
    + 'before you upgrade. (1) `dependsOn` was already LIVE on this surface and is kept: '
    + '`bulkParamToField` does not destructure it out, so it rides the adapter\'s spread onto '
    + 'the field bag, where the option widgets read it through `useCascadingOptions` and the '
    + 'reference-bearing pickers lower it into a candidate filter; an ablation removing it from '
    + 'that spread reddened 7 of 12 cases in the consuming repo, so retiring it was measured off '
    + 'the table. (2) the widget-config family rode the same spread and really was honoured by '
    + 'whichever widget read it — those keys are refused now rather than forwarded, which is the '
    + 'accepted cost of closing the shape (maintainer ruling, decision batch #146 item 4, letter '
    + 'A, 2026-09-17: 「Breaking for authored metadata」, one-shot, no grace window and no dual '
    + 'spelling). ⛔ Do not read their rejection as "the renderer ignores them", and ⛔ do not '
    + 'answer it by declaring the key on the object\'s FIELD: the bulk surface has no '
    + 'field-backed param route, so that value does not reach this dialog either. A census of '
    + 'authored bulk params taken at registration time over the two repositories reachable from '
    + 'that session found ZERO carrying an undeclared key (objectstack@176b03582e: 7 param '
    + 'literals; objectui@3e4f6324f7: 3), so no in-corpus configuration is known to break. '
    + '⚠️ That census did NOT cover hotcrm, which was unreachable from the session that took it '
    + '— that leg is UNMEASURED, not clean, and an upgrader with their own metadata corpus '
    + 'should run the check below rather than inherit this result.',
  acceptanceCriteria:
    'Every `bulkActionDefs[].params[]` entry in your stack parses with declared keys only — '
    + '`objectstack validate` (and `os lint` / `os build`) reports no `unrecognized_keys` under '
    + 'a `params` path. Each rejection carries its own fix; apply the rename it names, move the '
    + 'key to the layer the prescription points at, or delete metadata that was never read. '
    + '⚠️ Parsing clean is the weaker half here, because the widget-config keys were being '
    + 'HONOURED rather than dropped: for every param that carried one, re-open the bulk dialog '
    + 'and confirm the control still behaves as authored (a number param\'s bounds and step, a '
    + 'file param\'s accepted types and size cap, a picker\'s base filters and columns) — where '
    + 'it does not, the configuration is genuinely gone and the remedy is a spec issue asking '
    + 'for the key, not a local workaround. `dependsOn` needs no action: re-open one bulk dialog '
    + 'that declares it and confirm the dependent control is still gated until its parent param '
    + 'is filled, and that picking the parent still narrows the child.',
};
