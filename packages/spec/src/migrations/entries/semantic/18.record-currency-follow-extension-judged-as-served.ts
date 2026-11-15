// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the record-currency follow door (ADR-0144 D2 and
// D6, amended) as it now judges an `objectExtensions` entry and an
// `object_extension` item: against the object as the server serves it. No D2
// conversion: which field of the parent holds the currency code is the
// author's to say.
export const entry: SemanticMigration = {
  id: 'record-currency-follow-extension-judged-as-served',
  surface:
    'data.Field.currencyConfig on a field an `objectExtensions` entry (or a stored `object_extension` item) adds to '
    + 'an object: a record-mode amount whose `currencyField` is the path `MASTER_DETAIL.CODE`, judged against the '
    + 'object as the server serves it (its base, every enabled extension, and the incoming body). Where it is asked: '
    + 'an install, upgrade or reload on a running server (the engine\'s `manifest` service, POST '
    + '/api/v1/marketplace/install-local, the artifact hot reload), a published single save of an `object_extension` '
    + 'item through the `/meta` doors, and the batch writers. Also the owner of the extended object, registering after '
    + 'the extension, over the amounts the extension adds. Not the cold boot',
  replacement:
    'Name in the second segment of `currencyField` a field of the master_detail target that declares '
    + '`valueDomain: \'iso_4217_currency\'` (the refusal lists the candidates), or install the package that supplies '
    + 'that field first, or in the same artifact. When the owner of the extended object is refused over an '
    + 'extension\'s amount, the correction is the extension\'s package: it upgrades with the amount corrected, or is '
    + 'uninstalled, and the owner is then installed again unchanged. When a parent\'s upgrade is refused because it '
    + 'removes or de-codes a field an extension\'s amount follows, the refusal names that package and field: keep the '
    + 'field in the upgrade, or have that package move its amount first',
  reason:
    'An extension\'s following amount was judged as the extension\'s body alone, which holds only the fields it adds, '
    + 'so the following half was never asked: an extension-only package could add an amount following a parent field '
    + 'with no ISO 4217 code, a field that does not exist, or a field reached through its own new master_detail, and '
    + 'every write of that amount was then refused `ERR_CURRENCY_CODE_REQUIRED` or labelled with whatever the field '
    + 'held. Worse, the next upgrade of the parent\'s owner was refused over the extension\'s field, blaming a package '
    + 'that changed nothing. Every object layer is now judged as its served object, so the run that completes a bad '
    + 'pair is refused 422 `INVALID_METADATA` whichever end it holds, and a run that leaves a pair as it found it is '
    + 'not refused over it. A field another extension supplies counts only while that extension is installed and '
    + 'enabled. An extension of an object no package owns yet is no verdict until the owner registers. Packages '
    + 'installed before this release keep loading at every boot, which is not asked. There is no mechanical rewrite: '
    + 'only the author knows which parent field holds the code',
  acceptanceCriteria:
    'Install the extension package on a running server after the package owning the extended object and its parent, '
    + 'and confirm the answer is 200 and the served object carries the amount. Upgrade the parent\'s owner unchanged '
    + 'and confirm it installs. Insert a child row under a parent holding a code and confirm the amount is stored with '
    + 'that code',
};
