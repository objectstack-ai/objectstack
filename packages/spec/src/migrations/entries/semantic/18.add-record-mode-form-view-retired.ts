// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #24692 (ADR-0049 enforce-or-remove; ruling letter B′) — the D3 entry of the
// `add-record-mode-form-view-removed` family. Registered keys:
// `ui/AddRecordConfig:mode` and `ui/AddRecordConfig:formView`. The strip is
// lossless in pixels (no renderer read either key); what the conversion cannot
// do is decide which fields the create form asks for: since #36425 that is the
// object's `fieldGroups` and each field's `showOnCreate`, not a
// `formViews.create` declaration (no longer loaded).
export const entry: SemanticMigration = {
  id: 'add-record-mode-form-view-retired',
  surface: 'view.list.addRecord.mode / view.list.addRecord.formView — the list Add button\'s open mode and named form',
  replacement: 'Nothing replaces `mode`: the Add button opens the object\'s create form the way the '
    + 'object list\'s New opens it. In place of `formView`: the create form is the object\'s own. It '
    + 'lays out by the object\'s `fieldGroups` and leaves out every field marked `showOnCreate: false` '
    + '(an internal `formViews.create`, `form` or `formViews.default` is no longer loaded).',
  reason: 'The D2 conversion `add-record-mode-form-view-removed` deletes both keys from every '
    + '`addRecord` block it reaches — every list payload in `stack.views[]`, every object\'s '
    + '`listViews`, every page\'s `interfaceConfig` and every page `list-view` node. The delete '
    + 'changes no screen, because no renderer ever read either key. What it cannot decide is '
    + 'whether a `formView` that named some form other than the object\'s create form expressed a '
    + 'real need: if the author wanted adding a record to open a particular form, its sections '
    + 'become the object\'s `fieldGroups` and the fields it left out take `showOnCreate: false`, '
    + 'which then apply to every create entry of the object, not to one list.',
  acceptanceCriteria: 'No `addRecord` block declares `mode` or `formView`; the parse refuses '
    + 'either key by name. For each block whose `formView` named a form other than the default: '
    + 'either the fields that form left out carry `showOnCreate: false` and its sections are the '
    + 'object\'s `fieldGroups`, or the author decided the object\'s full create form is right. The '
    + 'Add button opens the create form in every case.',
};
