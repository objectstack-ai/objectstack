// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'picklist-binding-unknown-refused',
  surface:
    'data.Field.picklist on an object or an object extension saved or published through the metadata doors '
    + '(PUT /api/v1/meta/object/NAME, PUT /api/v1/meta/object_extension/NAME, POST /api/v1/packages/PKG/publish-drafts, '
    + 'the per-item publish and the restore doors): a select or multiselect field bound to a picklist name that no '
    + 'loaded package declares',
  replacement:
    'Bind the field to a picklist a package installed here declares (the package\'s own, a dependency\'s, the base '
    + 'package\'s of a .custom pair, or another installed package\'s), declare the picklist in a code package '
    + '(a *.picklist.ts file, or defineStack({ picklists })), or give the field its own options instead of picklist',
  reason:
    'A field bound to a picklist takes its options from that list and has none of its own. The metadata save and '
    + 'publish doors stored and published a field naming a list no loaded package declares (its draft read '
    + '_diagnostics.valid: true); the field was then served with no options, and the record validator refused every '
    + 'value of it ("takes its values from picklist ..., which no loaded package declares"). The boot and a late '
    + 'install already refuse the same shape for a package\'s own objects, and os validate / os build refuse it for a '
    + 'stack\'s own fields. The doors now refuse it 422 INVALID_METADATA at fields.FIELD.picklist, naming the field '
    + 'and the list. A binding the object already holds is not judged again on a re-save. There is no mechanical '
    + 'rewrite: whether the author meant another list, a list still to be declared or inline options is a judgement '
    + 'about the field.',
  acceptanceCriteria:
    'PUT /api/v1/meta/object/NAME?mode=draft&package=PKG with every picklist-bound field naming a declared list '
    + 'answers 200; POST /api/v1/packages/PKG/publish-drafts publishes it; GET /api/v1/meta/object/NAME serves each '
    + 'bound field with its options; POST /api/v1/data/NAME with one of those values answers 200.',
};
