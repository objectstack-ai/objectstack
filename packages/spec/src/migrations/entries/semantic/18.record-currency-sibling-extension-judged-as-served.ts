// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the record-currency follow door (ADR-0144 D2) as
// it now judges the ONE-SEGMENT `currencyField` of an amount an extension adds:
// against the object as the server serves it. No D2 conversion: which field
// holds each record's currency code is the author's to say.
export const entry: SemanticMigration = {
  id: 'record-currency-sibling-extension-judged-as-served',
  surface:
    'data.Field.currencyConfig on a field an `objectExtensions` entry (or a stored `object_extension` item) adds to '
    + 'an object: a record-mode amount whose `currencyField` is one segment, a sibling field name, judged against the '
    + 'object as the server serves it (its base, every enabled extension, and the incoming body). Where it is asked: '
    + 'a published single save of an `object_extension` item through the `/meta` doors (PUT '
    + '/api/v1/meta/object_extension/NAME), the batch writers, and an install, upgrade or reload on a running server. '
    + 'Also the owner of the extended object, re-registering without the code field an extension\'s amount names. Not '
    + 'the cold boot',
  replacement:
    'Name in `currencyField` a field of the extended object that declares `valueDomain: \'iso_4217_currency\'` (the '
    + 'refusal lists the candidates), or add such a field in the same extension and name it. When the owner of the '
    + 'extended object is refused because it drops or de-codes the field an extension\'s amount names, the refusal '
    + 'names that package: keep the field, or have that package move its amount first',
  reason:
    'An object body whose record-mode amount names a sibling field it does not declare, or one that holds no ISO '
    + '4217 code, is refused 422 INVALID_METADATA at parse. An extension cannot be judged there, because its pointer '
    + 'may name a field only the owner declares, and the served-object door judged only the two-segment path. Such an '
    + 'extension was saved 200 and served, and every later write of the amount was refused ERR_CURRENCY_CODE_REQUIRED, '
    + 'prescribing a write into a field that does not exist. The door now judges the sibling pointer against the '
    + 'object as served, so the save is refused 422 INVALID_METADATA naming the field and the object\'s code-field '
    + 'candidates, and a pointer naming a code field the owner or another enabled extension declares is saved as '
    + 'before. A run that leaves such a pointer as it found it is not refused over it. Packages installed before this '
    + 'release keep loading at every boot, which is not asked. There is no mechanical rewrite: only the author knows '
    + 'which field holds the code',
  acceptanceCriteria:
    'PUT /api/v1/meta/object_extension/OBJECT?package=PKG with a record-mode amount whose currencyField names the '
    + 'object\'s code field (for example `currency_code`) answers 200, the served object carries the amount, and a '
    + 'write of the amount with a code in that field is stored',
};
