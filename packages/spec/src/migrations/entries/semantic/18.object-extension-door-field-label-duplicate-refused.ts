// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #33644: an accept-set narrowing of the runtime `object_extension` publish
// door. `field-label-duplicate` (`object-field-label-duplicate-refused`)
// judged `object` writes only, so an extension published at runtime (Studio's
// add-field on a `.custom` pair, `PUT /api/v1/meta/object_extension/TARGET`,
// an MCP or AI author) could add a field under a label the object it extends
// already shows, `owner_id` included, or two fields of its own under one
// label. It now asks the same question there. No
// D2 conversion: which field keeps the label is the author's choice and is
// not recorded anywhere, and a stored row is not re-judged until it is
// published again.
export const entry: SemanticMigration = {
  id: 'object-extension-door-field-label-duplicate-refused',
  surface:
    'an `object_extension` item published at runtime (Studio\'s add-field on a `.custom` pair, '
    + '`PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) whose `fields` add a visible '
    + 'field under a label the extended object already shows, or under the label of another field of the same '
    + 'extension, as written or in a locale a reader is served, '
    + 'e.g. `{ extend: \'crm_ticket\', fields: { assignee__c: { type: \'user\', label: \'负责人\' } } }` beside the '
    + 'injected `owner_id`, which a `zh-CN` reader is served as 负责人.',
  replacement:
    'Give the extension\'s field a label of its own (one neither the object nor another field of the extension '
    + 'shows), set `hidden: true` on it, or drop it and use the field the object '
    + 'already shows (the platform\'s `owner_id` for an owner). The door compares the labels as written and as the '
    + 'platform translates its own columns (`owner_id` reads 负责人 to a `zh-CN` reader); it reads no translation '
    + 'bundle, so a bundle edit neither raises nor clears a refusal there (`os build` and `os validate` judge the '
    + 'bundle). The door refuses the shape as `field-label-duplicate` (`422 INVALID_METADATA`, located on the '
    + 'extended object, `objects.TARGET.fields`), naming the object, every field of the group and the shared label.',
  reason:
    'The registry folds an extension\'s fields onto the object it extends, so a field it adds under a label the '
    + 'object already shows is a second column of that name in every grid, card and form of the object, and '
    + 'editing one reads as editing the other. `os build` and `os validate` refuse it when the stack declares the '
    + 'object; the publish door ran the rule on `object` writes only, so the same entry published with a 200. The '
    + 'door now judges the object as it will be served after the write: the entry folded in among the object\'s '
    + 'other packages\' extensions by priority, without the package\'s own stored extension, which the write '
    + 'replaces. Only a clash the entry creates is charged; one the object already carried, or what is left of it '
    + 'after the entry took a field out, is not the extension\'s to answer for. Measured at the change: the two first-party entries (`examples/app-showcase` '
    + 'on `showcase_account`, `plugin-auth` on `sys_sso_provider`) add no clash. ADR-0087.',
  acceptanceCriteria:
    'Publish each extension again: the publish answers 200 with no `field-label-duplicate` issue, and every '
    + 'visible field of the extended object reads under its own label as written and in every locale the platform '
    + 'translates. An extension already stored in the shape keeps being served; its next publish is refused until '
    + 'the field is relabelled, hidden or dropped.',
};
