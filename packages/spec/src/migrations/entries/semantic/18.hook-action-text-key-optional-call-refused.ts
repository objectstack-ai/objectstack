// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry for the save door's literal `ctx.text` reader reading the
// optional-call `ctx.text?.('key')` and non-null `ctx.text!('key')` shapes
// (ruling 6913660232 parameter 7: a key asked for literally that `texts` does
// not declare is refused at save). It narrows the hook's and the action's
// accept set; no key is removed, so there is no tombstone and no D2
// conversion: which sentence the author meant is a judgement about the hook.
export const entry: SemanticMigration = {
  id: 'hook-action-text-key-optional-call-refused',
  surface:
    'hook.body.source / hook.handler and action.body.source on a hook or a type: script action that declares '
    + 'texts: a literal ctx.text?.(KEY) or ctx.text!(KEY) call, awaited or not, whose KEY texts does not declare',
  replacement:
    'Declare the key under texts.KEY with the sentence the record keeps, or ask for one of the declared keys. '
    + 'The call shape is unchanged: ctx.text?.(KEY) and ctx.text!(KEY) stay legal for a declared key.',
  reason:
    'A key a hook or an action asks for literally that its texts does not declare was refused at save only for '
    + 'the plain call ctx.text(KEY). The optional-call and non-null shapes, which strict TypeScript reaches for '
    + 'because HookContext.text is optional, passed the save, and the runtime refused the key only when the code '
    + 'ran, as a fault naming the hook or action and the key. The save now refuses them with the same sentence, '
    + 'at body.source (or handler). A key that arrives any other way (a variable, a computed name) is still '
    + 'judged when the code runs. There is no mechanical rewrite: the code already failed at run time for that '
    + 'key, and whether to declare it or ask for another is a judgement about the sentence.',
  acceptanceCriteria:
    'objectstack validate reports no issue at body.source or handler for any hook or action that declares texts, '
    + 'and every key its code asks for through ctx.text, ctx.text?.( or ctx.text!( is a key of its texts.',
};
