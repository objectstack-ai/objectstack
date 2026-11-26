// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// [ruling 7000907189 point 4 · ADR-0049] A `transferBehavior: 'cascade'` the
// Change Owner action can never offer is refused at error by three
// @objectstack/lint rules (`validate-transfer-cascades.ts`): a parent that does
// not offer Change Owner, an object extension's field on an object that cannot
// take a cascade, a child whose declared exposure does not serve update. It
// narrows what `os validate` / `os build` / `os lint` accept; no key is removed,
// so there is no tombstone. Measured first-party exposure at this change: zero
// — no example app, platform object, skill or docs sample declares a cascade.
// Not converted: whether to drop the cascade or change the object is a judgement.
export const entry: SemanticMigration = {
  id: 'transfer-cascade-never-offered-refused',
  surface:
    'objects[].fields[].transferBehavior and objectExtensions[].fields[].transferBehavior set to cascade, on a '
    + 'lookup or master_detail field, loaded by os validate / os build / os lint, where the referenced parent is an '
    + 'object of the stack that does not offer Change Owner (ownership business_unit, org or none, any managedBy, '
    + 'systemFields false, an owner_id declared readonly, an external object with no provable owner, or '
    + 'userActions.transfer off, by the author or by the controlled_by_parent default); or where the field is added '
    + 'by an object extension to an object that cannot take a Change Owner cascade; or where the object holding the '
    + 'field declares an enable block that does not serve update (apiEnabled false, or apiMethods without update).',
  replacement:
    'Set the field\'s transferBehavior to none or remove it; or change the object the finding names: make the '
    + 'parent offer Change Owner (the reason clause says how, where it can), make the extended object offer it, or '
    + 'add update to the child\'s enable.apiMethods (or turn enable.apiEnabled on). Refused at error as '
    + '`transfer-cascade-parent-without-change-owner`, `transfer-cascade-extension-child-ineligible` and '
    + '`transfer-cascade-child-update-unexposed`.',
  reason:
    'The Change Owner endpoint re-judges every relationship on every call and offers only the ones that can act: '
    + 'it refuses the whole call on a parent that does not offer the action, and leaves out a child that cannot take '
    + 'a cascade or whose exposure does not serve update. So each such declaration parsed, deployed and never ran, '
    + 'and nothing told the author. The verdicts come from the spec predicates the endpoint reads '
    + '(resolveUserActionTransfer, transferCascadeIneligibilityReason, apiExposureDenialReason), so no stored row '
    + 'changes shape and nothing the runtime did changes. ObjectSchema already refused a cascade on a field the '
    + 'object declares itself when the object cannot take one; an extension\'s field skipped that parse. No '
    + 'first-party stack declares a cascade today. There is no mechanical rewrite: dropping the cascade and '
    + 'changing the object are different intents.',
  acceptanceCriteria:
    'Load every stack (`os validate` or `os build`): no `transfer-cascade-parent-without-change-owner`, '
    + '`transfer-cascade-extension-child-ineligible` or `transfer-cascade-child-update-unexposed` finding. For a '
    + 'cascade kept, GET /api/v1/data/PARENT/change-owner/cascades lists the relationship.',
};
