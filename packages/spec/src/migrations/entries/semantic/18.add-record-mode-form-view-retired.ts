// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #24692 (ADR-0049 enforce-or-remove; ruling letter B′) — the D3 entry of the
// `add-record-mode-form-view-removed` family. Registered keys:
// `ui/AddRecordConfig:mode` and `ui/AddRecordConfig:formView`. The strip is
// lossless in pixels (no renderer read either key); what the conversion cannot
// do is give a list its own create form, which is a `formViews.create`
// declaration the author writes.
export const entry: SemanticMigration = {
  id: 'add-record-mode-form-view-retired',
  surface: 'view.list.addRecord.mode / view.list.addRecord.formView — the list Add button\'s open mode and named form',
  replacement: 'Nothing replaces `mode`: the Add button opens the object\'s create form the way the '
    + 'object list\'s New opens it. In place of `formView`, the create form is chosen by convention: '
    + 'declare `formViews.create` on the object\'s view container to give creating its own form; '
    + 'without one, `form` (or `formViews.default`) is used.',
  reason: 'The D2 conversion `add-record-mode-form-view-removed` deletes both keys from every '
    + '`addRecord` block it reaches — every list payload in `stack.views[]`, every object\'s '
    + '`listViews`, every page\'s `interfaceConfig` and every page `list-view` node. The delete '
    + 'changes no screen, because no renderer ever read either key. What it cannot decide is '
    + 'whether a `formView` that named some form other than the object\'s create form expressed a '
    + 'real need: if the author wanted adding a record to open a particular form, that form '
    + 'becomes the object\'s `formViews.create`, which then applies to every create entry of the '
    + 'object, not to one list.',
  acceptanceCriteria: 'No `addRecord` block declares `mode` or `formView`; the parse refuses '
    + 'either key by name. For each block whose `formView` named a form other than the default: '
    + 'either the object\'s view container declares that form as `formViews.create`, or the author '
    + 'decided the default form is right. The Add button opens the create form in every case.',
};
