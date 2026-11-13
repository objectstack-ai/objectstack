// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the record-currency follow door (ADR-0144 D2 and
// D6, amended) as a running install, upgrade or reload now hears it. No D2
// conversion: which field of the parent holds the currency code, and whether a
// roll-up is in the parent's currency at all, is the author's to say.
export const entry: SemanticMigration = {
  id: 'record-currency-follow-pair-refused-on-install-and-reload',
  surface:
    'data.Field.currencyConfig on the objects a code package or release artifact registers on a RUNNING server '
    + '(its `objects`, its `objectExtensions`, its nested plugins\' objects and the artifact\'s top-level objects), through '
    + 'the engine\'s `manifest` service: POST /api/v1/marketplace/install-local (an inline manifest or a cloud-fetched '
    + 'version, a first install or an upgrade) and the artifact hot reload. Two pairs: a record-mode amount whose '
    + '`currencyField` is the path `MASTER_DETAIL.CODE` where CODE names no field of the master_detail target, or a field '
    + 'that holds no ISO 4217 code; and a `summary` declaring `currencyMode: \'record\'` that rolls up a child amount '
    + 'following no record\'s currency. A pair is judged when the install registers only ONE end of it: a package that '
    + 'holds just the parent, or just the child, is refused over the other end that another package or the '
    + 'environment holds, also when its own objects did not change. Not the cold boot',
  replacement:
    'For a following amount, name in the second segment of `currencyField` a field of the master_detail target that '
    + 'declares `valueDomain: \'iso_4217_currency\'` (the refusal lists the candidates), or add that field to the parent '
    + 'in the same package, in another package of the same artifact, or through `objectExtensions`. For a `record` '
    + 'roll-up, make the child amount follow the parent (`currencyField: \'MASTER_DETAIL_FIELD.CODE_FIELD\'`), or drop '
    + '`currencyMode: \'record\'` from the summary. The refusal names the object and the field that hold the declaration. '
    + 'When that object is not one of the package being installed (a child of its parent, or the parent of its child, '
    + 'held by another package or by the environment), the correction is that holder\'s: it upgrades its package, or '
    + 'saves the environment\'s object, with the declaration corrected as above, and the refused package is then '
    + 'installed again unchanged; or the refused package\'s author supplies what the other end names (the code field '
    + 'a child follows, or an amount that follows the parent)',
  reason:
    '`defineStack` refuses both pairs where one stack holds both objects, and a single save, a publish and the batch '
    + 'writers refuse them on a running server. A code package installed, upgraded or reloaded on a running server was '
    + 'never asked: the pair registered, every write of the following amount was then refused '
    + '`ERR_CURRENCY_CODE_REQUIRED` or labelled with whatever the named field held, and a `record` roll-up totalled '
    + 'amounts in no one currency. The registry now asks once, when everything the install or reload registers is '
    + 'registered, so a pair one package of the artifact, its extensions or its top-level objects completes for another '
    + 'passes, and an upgrade that moves both ends is judged against the new parent. A refused pair refuses the whole '
    + 'install or upgrade with 422 `INVALID_METADATA` in `defineStack`\'s words (install-local answers 422 '
    + '`PLUGIN_REGISTER_FAILED` carrying them) and nothing of it stays registered or ledgered: an upgrade leaves the '
    + 'installed version serving. A refused reload keeps every definition that was served and logs `reload refused` '
    + 'with the pair, so one bad pair in any package of the reloaded artifact holds back that whole reload until it is '
    + 'corrected. Packages installed before this release: a package holding such a pair still loads at every boot, '
    + 'which is not asked, and serves as it did; its next upgrade or reload is refused until the pair is corrected, '
    + 'and so is the next upgrade or reload of a package that holds only the other end of that pair, although nothing '
    + 'in that package is wrong. A pair is judged against the object the server serves. Where the server serves an '
    + 'object from the environment\'s own object of the same name, lying over the one a package ships, and that '
    + 'object lacks the other end of the pair, the install, upgrade or reload is refused although the package\'s own '
    + 'definitions hold the pair: the refusal then ends by naming that object and saying so, and the product has no '
    + 'remedy for this case today. '
    + 'There is no mechanical rewrite: only the author knows which parent field holds the code',
  acceptanceCriteria:
    'Run `objectstack validate` over the stack that holds both objects and confirm no record-currency path finding. '
    + 'Install or upgrade the package on a running server and confirm the answer is 200 with `hotLoaded: true`; after an '
    + 'artifact reload confirm the log holds no `reload refused` warning and the objects read their new definitions. '
    + 'Insert a child row under a parent holding a code and confirm the amount is stored with that code',
};
