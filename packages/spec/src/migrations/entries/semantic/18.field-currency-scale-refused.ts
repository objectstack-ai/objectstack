// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'field-currency-scale-refused',
  surface: 'object.fields.<name>.scale on a field whose `type` is `currency` — any declared value, '
    + '`scale: 0` included; the `Field.currency` helper passes it through unchanged. `scale` on '
    + '`number`, `percent`, `rating`, `slider` and `formula` is untouched',
  replacement: 'no `scale` on a currency field. DELETE the key — that is the whole migration: a '
    + 'currency amount\'s decimal places are its currency\'s, not a field setting. The currency\'s '
    + 'ISO 4217 minor unit decides how the amount displays, and the field\'s write allowance stays '
    + 'unconstrained — a currency write is accepted with the decimals it carries, as it always was '
    + 'on a currency field that declared no `scale`. ⛔ Nothing replaces the key: do not re-declare '
    + 'its value under any other key.',
  reason:
    'Maintainer ruling 5791803339 (batch #215 item 1, letter B) retires `scale` from the '
    + '`currency` field type, and ruling 5805782503 (batch #218 item 2, letter 乙 — a currency\'s '
    + 'decimal places are the currency\'s, not a setting) words the remedy. On a currency field the '
    + 'key was three-faced: the metadata-admin field designer offered it as stored metadata, the '
    + 'amount\'s cell never read it (fraction digits come from the currency\'s ISO 4217 minor '
    + 'unit), and the record validator\'s `max_scale` branch still refused writes carrying more '
    + 'decimals — so an author who set it bought a narrower write contract and no visible change. '
    + '`FieldSchema` now refuses the key on `currency` at parse, and the validator stops reading it '
    + 'for the type in the same release, so a stored declaration narrows nothing either. ⛔ No '
    + 'alias and no grace window, per the ruling. NOT mechanically converted, deliberately: a '
    + 'conversion that dropped the key would accept it on every load, which is the grace window '
    + 'the ruling refused; the refusal names the key and its one-line fix instead. Two behaviour '
    + 'changes ride along and are part of what an upgrade means: (1) a currency write with more '
    + 'decimals than a former `scale` is now ACCEPTED — the write allowance stays unconstrained, '
    + 'the contract every currency field without `scale` already had; (2) at the console pin '
    + 'measured when this was written, the grid summary footer and the dashboard metric widget '
    + 'read a currency column\'s `scale ?? 0`, and the ruling lands this change only after the '
    + 'console derives both faces from the currency, the way the cell does, and the pin has moved '
    + 'past that change. Population measured at the change, on origin/main 1f89ba0d70 by AST '
    + 'sweep: 15 `Field.currency` declarations in `examples/` (app-crm 4, app-showcase 11) and 13 '
    + 'documentation examples carried `scale`, every one of them `scale: 2`; all were deleted in '
    + 'the same change.',
  acceptanceCriteria:
    'Every field in the stack parses: `ObjectSchema.parse()` / `objectstack validate` report no '
    + 'issue on a `scale` path of a `currency` field. A currency field that carried `scale` no '
    + 'longer declares it, and a diff of the field shows that one line deleted and no key added. '
    + 'Its amount\'s cell renders the currency\'s ISO 4217 minor-unit digits, as before, and a '
    + 'write with more decimals than the old `scale` is accepted where it was refused with '
    + '`max_scale`; `number` / `percent` / `rating` / `slider` fields keep their `scale` and '
    + 'still refuse over-scale writes.',
};
