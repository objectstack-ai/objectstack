// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'refusal-reasons-list-literal-judged',
  surface: 'a hook `body.source` or a `script` action `body.source` whose `throw` carries a `reasons` key beside a '
    + 'code its `refusals` catalogue declares: `throw { code, reasons: [ … ] }`, or `e.reasons = [ … ]` on an error '
    + 'the body throws',
  replacement: 'name in `reasons` only reasons the code declares under `refusals.<CODE>.reasons`, each as '
    + '`{ reason, params? }` (declare `reasons` on the code, with each sentence, where it has none); or rename a '
    + "`reasons` property the body uses for its own data (for example to `items`, or put it under `params`).",
  reason:
    'A refusal may now name an ordered list of declared reasons in one throw, `{ code, reasons: [{ reason, params? }, '
    + "… ] }`, each rendered in the caller's locale as one line of `userMessage` and of `details.refusals`. Before, a "
    + '`reasons` key on a thrown refusal was ignored and the code\'s own sentence answered. Now it is read: at save, a '
    + 'literal list naming a reason under a code that declares no `reasons` is refused at `body.source` (a literal '
    + 'reason the code does not declare under its `reasons` was already refused), and so is a literal '
    + '`e.reasons = [ … ]` list on a thrown error naming an undeclared reason. At run, a `reasons` value that is empty, '
    + 'not a list of `{ reason, params? }`, thrown beside a `reason`, or naming an undeclared reason is the loud 500 '
    + 'fault naming the hook or action and the code, where the declared sentence and status answered before. Only a '
    + '`reasons` key that is a direct member of the thrown object is read; a nested one (`params: { reasons }`) is '
    + 'the body\'s own data. There is no mechanical rewrite: whether the key was meant as the list or as the body\'s '
    + 'own property is the author\'s call.',
  acceptanceCriteria:
    'Every hook and `script` action that declares `refusals` saves (`os validate` reports no undeclared-reason issue '
    + 'at `body.source`), and no run of it answers the 500 refusal-list fault: every thrown `reasons` key is a '
    + 'non-empty list of reasons its code declares, with no `reason` beside it.',
};
