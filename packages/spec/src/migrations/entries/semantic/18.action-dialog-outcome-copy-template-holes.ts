// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #27948 (ruling A, step 2) — an action's param dialog `description`, each
// param's `helpText` and each `outcomeMessages` entry became ADR-0032
// `template` slots, the family `confirmText` / `successMessage` joined in
// #24814: holes are `{{ }}` over the roots the console's runner binds, and the
// doors refuse a `${…}` token there. Semantic only: the `${…}` reading took any
// expression the runner's evaluator could run (`${record.user_id?.name ??
// 'this member'}`), and a template hole holds no logic, so no conversion maps
// every such sentence; the console keeps reading `${…}` in a stored sentence
// with no `{{ }}` hole, so stored copy keeps working until its next save.
export const entry: SemanticMigration = {
  id: 'action-dialog-outcome-copy-template-holes',
  surface: 'an action\'s `description`, each `params[].helpText` and each `outcomeMessages` entry (an object\'s '
    + '`actions[]`, the stack\'s `actions[]`, and an inline `properties.action` param\'s `helpText`) — a string, '
    + 'or each value of an inline locale map, carrying a `${…}` token such as `${record.email}` or '
    + '`${result.email}`',
  replacement: 'the `{{ }}` hole over the same path: `Resend the invitation to ${record.email}?` becomes '
    + '`Resend the invitation to {{ record.email }}?`, and `Invitation sent to ${result.email}` becomes '
    + '`Invitation sent to {{ result.email }}`. `description` and `helpText` read `record`, the record the action '
    + 'runs against; an `outcomeMessages` entry reads `result` (the handler\'s answer) and `record`. A fallback '
    + 'written as `${record.owner?.name ?? \'nobody\'}` becomes `{{ record.owner.name | default:\'nobody\' }}` '
    + '(the `default` formatter also covers an empty value); other logic moves into the handler\'s answer and is '
    + 'read from `result`.',
  reason: 'These three keys were plain copy that the console\'s action runner filled with `${…}` through its '
    + 'expression evaluator, over its whole context, while `confirmText` and `successMessage` beside them were '
    + 'already `template` slots that refuse `${…}`; one action spoke two hole syntaxes. They are now `template` '
    + 'slots too: a bare string parses to the `{ dialect: \'template\', source }` envelope, and `objectstack '
    + 'validate`, `compile` and the publish gate refuse a `${…}` token, a single-brace `{x}` token, a hole over a '
    + 'root the runner does not bind, a hole holding logic or an unknown formatter, and a blank sentence, each '
    + 'named with its `{{ }}` spelling. The text still parses, so a stored action loads; the console still fills '
    + '`${…}` in a sentence with no `{{ }}` hole, so stored copy reads as before until its next save, which is '
    + 'judged. No conversion is registered: a `${…}` token held an expression, and a hole holds a path and '
    + 'formatters only, so a token with logic in it has no mechanical `{{ }}` spelling.',
  acceptanceCriteria: 'Run `objectstack validate`: it reports no finding at an action\'s `description`, '
    + '`params[N].helpText` or `outcomeMessages.OUTCOME`. Open the action\'s param dialog from a list row and from '
    + 'the record header and confirm the line and each hint carry the record\'s value; run the action to each '
    + 'outcome it answers and confirm the toast carries the answer\'s value, with no `{{` or `${` left in the text.',
};
