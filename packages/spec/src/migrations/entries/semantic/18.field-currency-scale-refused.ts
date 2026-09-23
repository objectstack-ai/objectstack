// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'field-currency-scale-refused',
  surface: 'object.fields.<name>.scale on a field whose `type` is `currency` — any declared value, '
    + '`scale: 0` included; the `Field.currency` helper passes it through unchanged. `scale` on '
    + '`number`, `percent`, `rating`, `slider` and `formula` is untouched',
  replacement: 'no `scale` on a currency field. DELETE the key — the default, and the whole '
    + 'migration for a field that declares no `currencyConfig`: the amount\'s cell renders the '
    + 'currency\'s own ISO 4217 minor-unit width either way. On a field that ALREADY declares a '
    + '`currencyConfig`, the value may instead move to `currencyConfig.precision` when that key '
    + 'is absent (when it is present, delete `scale`); under `currencyMode: \'fixed\'` a moved value '
    + 'that contradicts the fixed currency\'s ISO 4217 digits is refused there in turn. ⛔ Never '
    + 'ADD a `currencyConfig` only to carry the value: the block materializes `currencyMode: '
    + '\'dynamic\'` and `defaultCurrency: \'CNY\'`, and the second changes the currency the field '
    + 'resolves on every face that reads it.',
  reason:
    'Maintainer ruling 5791803339 (batch #215 item 1, letter B) retires `scale` from the '
    + '`currency` field type. On a currency field the key was three-faced: the metadata-admin '
    + 'field designer offered it as stored metadata, the amount\'s cell never read it (fraction '
    + 'digits come from the currency\'s ISO 4217 minor unit), and the record validator\'s '
    + '`max_scale` branch still refused writes carrying more decimals — so an author who set it '
    + 'bought a narrower write contract and no visible change. `FieldSchema` now refuses the key '
    + 'on `currency` at parse, and the validator stops reading it for the type in the same '
    + 'release, so a stored declaration narrows nothing either. ⛔ No alias and no grace window, '
    + 'per the ruling. NOT mechanically converted, deliberately: whether a given declaration '
    + 'should be deleted or moved depends on whether the field already declares a '
    + '`currencyConfig`, and an automatic move onto a field that has none would ADD that block '
    + 'and with it a defaulted `defaultCurrency` — a silent currency change is worse than the '
    + 'refusal it would avoid. Two behaviour changes ride along and are part of what an upgrade '
    + 'means: (1) a currency write with more decimals than a former `scale` is now ACCEPTED '
    + '(enforcing `currencyConfig.precision` on writes instead was offered to the maintainer and '
    + 'not taken); (2) in the console version pinned when this landed, the grid summary footer '
    + 'and the dashboard metric widget read a currency column\'s `scale ?? 0`, so a deleted '
    + '`scale: 2` renders those two faces with zero decimals until the console derives them from '
    + 'the currency the way the cell does. Population measured at the change, on origin/main '
    + '1f89ba0d70 by AST sweep: 15 `Field.currency` declarations in `examples/` (app-crm 4, '
    + 'app-showcase 11) and 13 documentation examples carried `scale`, every one of them '
    + '`scale: 2`; all were deleted in the same change.',
  acceptanceCriteria:
    'Every field in the stack parses: `ObjectSchema.parse()` / `objectstack validate` report no '
    + 'issue on a `scale` path of a `currency` field. A currency field that carried `scale` either '
    + 'no longer declares it, or carries the value as `currencyConfig.precision` on a '
    + '`currencyConfig` it already declared before the migration — never on one added for the '
    + 'purpose, which a diff of the field shows as a new `currencyConfig` block. Its amounts '
    + 'render in the same currency as before, and a write with more decimals than the old '
    + '`scale` is accepted where it was refused with `max_scale`; `number` / `percent` / '
    + '`rating` / `slider` fields keep their `scale` and still refuse over-scale writes.',
};
