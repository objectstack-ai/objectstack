// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of a `dynamic` summary roll-up (ADR-0144 D6 and D8
// rule 5) as the engine registry now judges it, beside `defineStack`: only
// over a child amount in the home currency (a `currency` field in `dynamic`
// mode, a stored home amount included), against the objects as the server
// serves them.
// The widening that admitted the home roll-up shipped in a `next` snapshot of
// the spec before the engine door judged it, so a body that snapshot accepted
// on a running server can be refused now. No conversion: which child field
// holds the home amount is the author's to say.
export const entry: SemanticMigration = {
  id: 'summary-dynamic-currency-rollup-home-amount-judged-as-served',
  surface:
    'data.Field.currencyConfig on a `summary` field with `function` `sum` / `min` / `max` / `avg` that declares '
    + '`currencyMode: \'dynamic\'` (or a `currencyConfig` naming no mode). Where it is asked: a published single save or '
    + 'publish of an object or an `object_extension` item through the `/meta` doors, the batch writers, and the end of '
    + 'an install, upgrade or reload run on a running server, against the parent and the child as served (their bases '
    + 'and every enabled extension), in both directions: a parent saving such a roll-up, and a child saved so that a '
    + 'registered parent\'s roll-up no longer reads an amount in the home currency. Also `defineStack`, where a home '
    + 'amount now counts only when its `homeAmount` is valid as declared. Not the cold boot',
  replacement:
    'Roll up an amount of the child in the home currency: a `currency` field in `dynamic` mode (an absent mode is '
    + '`dynamic`), a stored home amount included (the refusal lists them), declare `currencyMode: \'fixed\'` with the '
    + 'code when every amount the roll-up reads is in that one currency, or delete `currencyConfig` on the summary. When an '
    + '`objectExtensions` entry declares the home amount, give it a `readonly` `dynamic` currency field of its own and '
    + 'the record-mode amount that converts into it',
  reason:
    'A `dynamic` summary is drawn in the organization\'s home currency, which is right only for a roll-up of an amount '
    + 'in that currency: a child `currency` field in `dynamic` mode, a stored home amount included. Both doors now '
    + 'admit it only there. Before this entry, `defineStack` judged it (then admitting a stored home amount alone), '
    + 'but the engine registry, which a single-object save on a running server meets, judged only `record` roll-ups, '
    + 'so a `dynamic` roll-up over a `fixed` EUR amount, a plain number or a formula was stored and its total shown '
    + 'with the home currency\'s symbol. Since this entry it is refused 422 `INVALID_METADATA` there, in the words '
    + '`defineStack` uses. A `homeAmount` makes a field a home amount only where '
    + 'it is valid as declared (a record-mode `currency` amount naming another `readonly` `dynamic` currency field of '
    + 'the same object, with no `expression`, claimed by that one amount), so an extension cannot make a plain number '
    + 'a home amount by naming it. Roll-ups stored before this release keep loading at every boot, which is not asked. '
    + 'There is no mechanical rewrite: only the author knows which amount the roll-up should total',
  acceptanceCriteria:
    'Save the parent with its `dynamic` roll-up of the child\'s home amount through PUT /api/v1/meta/object/PARENT on a '
    + 'running server and confirm the answer is 200 and the record page shows the total with the home currency\'s '
    + 'symbol. Save one over a child field that is not a `currency` field in `dynamic` mode (a `fixed` EUR amount, a '
    + 'plain number or a formula) and confirm the answer is 422 `INVALID_METADATA` naming the field',
};
