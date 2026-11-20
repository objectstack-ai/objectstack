// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry for the save door's literal `ctx.text` reader reading the
// optional-call shape `ctx.text?.('key')` (ruling 6913660232 parameter 7: a
// key asked for literally that `texts` does not declare is refused at save).
// It narrows the hook's accept set, the released half; the action half
// (`ActionSchema.texts`) ships already narrowed. No key is removed, so there is
// no tombstone and no D2 conversion: which sentence the author meant is a
// judgement about the hook.
export const entry: SemanticMigration = {
  id: 'hook-action-text-key-optional-call-refused',
  surface:
    'hook.body.source / hook.handler on a hook that declares texts: a literal optional call ctx.text?.(KEY), '
    + 'awaited or not, whose KEY texts does not declare. A type: script action\'s body.source is read the same '
    + 'way from the release that introduces action texts, so no released action is affected',
  replacement:
    'Declare the key under texts.KEY with the sentence the record keeps, or ask for one of the declared keys. '
    + 'The optional call stays legal for a declared key.',
  reason:
    'A key a hook asks for literally that its texts does not declare was refused at save only for the plain '
    + 'call ctx.text(KEY). The optional call ctx.text?.(KEY), which strict TypeScript reaches for because '
    + 'HookContext.text is optional, passed the save, and the runtime refused the key only when the hook ran, '
    + 'as a fault naming the hook and the key. The save now refuses it with the same sentence, at body.source '
    + 'or handler. A key that arrives any other way (a variable, a computed name) is still judged when the code '
    + 'runs. There is no mechanical rewrite: the hook already failed at run time for that key, and whether to '
    + 'declare it or ask for another is a judgement about the sentence.',
  acceptanceCriteria:
    'objectstack validate reports no issue at body.source or handler for any hook that declares texts, and '
    + 'every key its code asks for through ctx.text or the optional call ctx.text?.( is a key of its texts.',
};
