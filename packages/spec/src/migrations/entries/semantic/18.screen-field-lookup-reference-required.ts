// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// A `type: 'lookup'` screen field must now name its target object. Registered as
// SEMANTIC and never as a D2 conversion because the remedy is a value the stored
// metadata does not contain: a bare lookup says which field it is, never which
// object it meant, so any transform would have to invent one.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'screen-field-lookup-reference-required',
  surface:
    "The `reference` key of a `type: 'lookup'` field on a `screen` node — "
    + '`flows[].nodes[].config.fields[]` where the node `type` is `screen` and the field '
    + "`type` is `lookup` (`ScreenFieldConfigSchema`). Nothing is renamed, retired or "
    + 're-typed and the key set does not move: `reference` was already declared and '
    + 'already optional in the shape. What narrows is the ACCEPT SET for one value of the '
    + "sibling `type` — a `lookup` field with no `reference`, or with a blank one, parsed "
    + 'before this major and is refused now. Every other widget hint is untouched, and a '
    + '`lookup` field that already names its target parses byte-identically.',
  replacement:
    "Name the object whose records the picker offers, beside the type: "
    + "`{ name: 'resolved_by_article', type: 'lookup', reference: 'crm_knowledge_article' }`. "
    + 'The value is an object NAME (the canonical id — same string `FieldSchema.reference` '
    + 'carries), not a label and not a record id. ⚠️ There is deliberately no default and no '
    + 'inference: a picker pointed at the wrong object is worse than one that refuses to '
    + 'load, because it offers a human a plausible list of the wrong records and the flow '
    + 'stores the id it is given. Where the field genuinely has no target object — the '
    + 'author was using `lookup` to mean "type an id here" — the fix is the other '
    + "direction: change `type` to `'text'`, which is what that field actually was, and "
    + 'keep the prose that asked for an id in `inlineHelpText`.',
  reason:
    'Maintainer ruling A′, 2026-09-13 (decision batch #130 item 1), verbatim, '
    + 'untranslated: 「同意」. ADR-0078 forbids metadata that parses, carries no marking and '
    + 'does nothing — and its own worked example of that state is a `lookup` with no '
    + '`reference`: the field renders a picker, the picker has no object to query, and '
    + 'nothing anywhere says so. The key shipped OPTIONAL on this surface one release '
    + 'earlier, on the argument that flows declaring a bare `lookup` already exist; the '
    + 'ruling reversed that, holding that a degraded shape which ships is not a reason to '
    + 'bend the contract to it. ⛔ NOT losslessly convertible, and the reason is the same '
    + 'one `schedule-flow-acting-organization-required` gives: the remedy is a value the '
    + 'artifact does not contain. A bare lookup records the field name and nothing about '
    + 'its intended object, so `objectstack migrate meta` can identify every site but can '
    + 'answer none of them — and a conversion that guessed (the first object with a '
    + 'matching-looking name, the flow\'s trigger object) would write an authoritative '
    + 'wrong answer into metadata a human then trusts. Registered under ADR-0087 D3 rather '
    + 'than left silent because the change DOES carry a prescription a human can execute, '
    + 'which is what D3 says a structured TODO is for.',
  acceptanceCriteria:
    "Every `type: 'lookup'` field on every `screen` node in the stack declares a non-empty "
    + '`reference`, and the stack parses: `ScreenFieldConfigSchema` refuses the bare form '
    + 'with a message addressed to `reference` '
    + '(`SCREEN_FIELD_LOOKUP_REFERENCE_REQUIRED`), so a full metadata parse — `os lint`, or '
    + 'any publish — reports one issue per unfixed site and names the FLOW and the FIELD in '
    + 'its path. Work the list to empty rather than sampling it: a flow whose screen never '
    + 'reaches that node in testing is refused at publish just the same. For each site, '
    + 'answer which object the picker was meant to offer — the declaration is the answer, '
    + "and where there is no such object the field was never a lookup (retype it `'text'`). "
    + '⚠️ Runs SUSPENDED at a screen before the upgrade rehydrate their `ScreenSpec` from '
    + 'stored context, so an in-flight run parked on an unfixed screen carries the old '
    + 'shape: drain or re-drive those rather than assuming the fix reaches them '
    + 'retroactively.',
};
