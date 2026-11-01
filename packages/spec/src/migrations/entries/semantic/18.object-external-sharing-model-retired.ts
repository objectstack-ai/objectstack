// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23268 — ADR-0049 enforce-or-remove — the D3 entry of the
// `object-external-sharing-model-removed` family. Registered key:
// `data/Object:externalSharingModel`. The strip changes no row answer; what it
// cannot decide is whether something the author built assumed the key hid rows.
export const entry: SemanticMigration = {
  id: 'object-external-sharing-model-retired',
  surface: 'objects[].externalSharingModel — the external org-wide default for portal and partner principals',
  replacement:
    'Nothing: delete the key. sharingModel is the one org-wide default. A principal reaches a row it '
    + 'does not own through an explicit share, and an anonymous reader through a share link (publicSharing).',
  reason:
    'The D2 conversion `object-external-sharing-model-removed` deletes `externalSharingModel` from every '
    + 'object, and the delete is lossless: no request ever resolved an external principal, and the '
    + 'authorization kernel\'s `EXTERNAL` rung admits explicitly shared rows only, so the value changed no '
    + 'row answer. What the conversion cannot check is whether something the author built assumed it did — '
    + 'a portal, an integration or a review checklist that treated `externalSharingModel: private` as the '
    + 'thing keeping outside users away from an object\'s rows.',
  acceptanceCriteria:
    'No object carries `externalSharingModel`, and the parse refuses it with the prescription. Every '
    + 'read answers as it did before the upgrade. Nothing the author maintains relies on the key to limit '
    + 'what an outside user sees; outside access, where it exists, is granted by explicit shares or share links.',
};
