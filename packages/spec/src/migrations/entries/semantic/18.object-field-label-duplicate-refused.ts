// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The author-time rules refuse an object that shows two visible fields under one
// label (`field-label-duplicate`, `@objectstack/lint`). A structured TODO, not a
// D2 conversion: which of the two fields keeps the label, whether the second one
// should be hidden, or whether it duplicates a platform column and should be
// dropped, is the author's choice and is not recorded anywhere.
export const entry: SemanticMigration = {
  id: 'object-field-label-duplicate-refused',
  surface:
    'objects[].fields[].label, objectExtensions[].fields[].label and translations[].LOCALE.objects.OBJECT.fields.FIELD.label '
    + '— two or more visible fields of one object served under one label, the injected owner_id and created_* / '
    + 'updated_* columns included, as written or in any locale a reader is served',
  replacement:
    'Give each visible field its own label, in the translation bundle too when only a translation clashes; or set '
    + '`hidden: true` on the field readers should not see; or, when the field duplicates a platform column (an owner '
    + 'field beside `owner_id`), drop it and use the platform column. `os validate`, `os build`, `os lint` and the '
    + 'metadata publish door (`422 INVALID_METADATA` on an object write) refuse the shape as `field-label-duplicate`, '
    + 'an error that names every field of the group, the shared label and, when only some locales clash, those '
    + 'locales.',
  reason:
    'Every surface draws a field under its label: list grid headers, kanban card lines, form captions, export and '
    + 'import columns. Two visible fields of one label are two columns a person cannot tell apart, and editing one '
    + 'reads as editing the other. The common shape is a field added beside a platform column, such as a `user` field '
    + 'a `zh-CN` reader is served as 负责人 next to `owner_id`, which drives record ownership while the added field '
    + 'drives nothing. No mechanical move is lossless: which field keeps the label is not recorded. Measured at the '
    + 'change: two example apps of this repository carried the shape in their `zh-CN` bundle and were relabelled in '
    + 'the same change; HotCRM carried none. ADR-0087.',
  acceptanceCriteria:
    'Run `os validate` or `os build` over the stack: no `field-label-duplicate` finding. Every visible field of an '
    + 'object reads under its own label as written and in every locale its bundles or the platform translate. An '
    + 'installed app is not affected at load: no boot or registration path runs the author-time rules, and a stored '
    + 'object in the shape is still served; its next save through the publish door is refused until it is '
    + 'relabelled. Done when no authored or stored object carries the shape.',
};
