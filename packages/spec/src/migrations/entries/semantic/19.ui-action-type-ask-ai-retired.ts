// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0160 D7, seventh amendment — the D3 entry of the `ask_ai` action type's
// retirement. The data half is the D2 conversion `action-type-ask-ai-removed`,
// which deletes what it can prove nothing names; what it leaves is a declared
// `ask_ai` action that something in the stack names, and the references to it,
// which only the author can take out.
export const entry: SemanticMigration = {
  id: 'ui-action-type-ask-ai-retired',
  surface: 'the `ask_ai` action type, in every slot that takes one: a declared action\'s `type` (top-level or '
    + 'embedded in an object), an `element:button` inline action\'s `type`, `actionType` on an `action:button` / '
    + '`action:icon` row, `type` on an `action:group` / `action:menu` member, and a dashboard header action\'s '
    + '`actionType`',
  replacement:
    'none: delete the action and every reference to it — the names in a page header\'s `actions`, a list '
    + 'view\'s `rowActions` / `bulkActions`, a related list\'s `actions`, a quick-actions list, a record alert\'s '
    + '`actionName`, an app navigation entry. The shell\'s 「问 AI」 entry in the page header is the one way into '
    + 'the assistant, and it opens on the record in view by itself',
  reason:
    'ADR-0160 D7 as its seventh amendment rules: the maintainer retired `ask_ai` before 19.0.0 with no '
    + 'compatibility shim, because a button per page is a second entry to the assistant and the shell\'s 「问 AI」 '
    + 'entry already carries the record on the page; the accepted cost is that a list row has no ask-AI action '
    + 'of its own. The type was published only on the 19 prerelease line. Every authoring surface now refuses '
    + 'it with a prescription and converts nothing. The D2 conversion `action-type-ask-ai-removed` deletes from '
    + 'sources an `ask_ai` action that nothing in the stack names, and every inline row and container member '
    + 'that spells it; an action that something names is left as written with each reference, so the source '
    + 'still meets the refusal, and taking out the references is the author\'s. Stored rows and built '
    + 'artifacts are read without any `ask_ai` action, with the door\'s conversion notice; a stored `action` '
    + 'row that is one is served and registered as nothing, and is deleted by name through the metadata API',
  acceptanceCriteria:
    'No action, row or member in the stack is `ask_ai`; no page, view, app or related list names an action '
    + 'the stack does not define (`os validate` reports no `action-name-undefined` finding); every source '
    + 'parses under the new schema.',
  conversionIds: ['action-type-ask-ai-removed'],
};
