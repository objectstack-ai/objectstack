// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0055 §1, judged on the object the runtime runs. An accept-set narrowing
// of the stack schema: an objectExtensions entry that leaves a
// controlled_by_parent object the same stack declares with anything but one
// required master_detail is refused, as the same object declared directly
// already was (cbp-master-relation-tiers-retired). No D2 conversion: which
// master stays is the owner's pick, and turning one into a lookup changes what
// deleting its master does. No stored row carries the shape — an extension is
// merged only when a stack or artifact registers — so the consequence at rest
// is an artifact built before 18, which its load now refuses.
export const entry: SemanticMigration = {
  id: 'cbp-extension-merged-master-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'objectExtensions[].fields (also packages[].manifest.objectExtensions[].fields) merged into a '
    + 'sharingModel: controlled_by_parent object the same stack or artifact declares',
  replacement:
    'The object as merged keeps exactly one master_detail field declared required: true. An extension of a '
    + 'controlled_by_parent object adds every other parent as a lookup field (drop the second master, or '
    + 'declare it type: \'lookup\'), and never redeclares the master field with required: false or another '
    + 'type. If a second parent must govern the rows, that is a different object design, decided by the '
    + 'owner of the object, not by an extension.',
  reason:
    'The registry merges every objectExtensions entry onto its target at boot, a field replaced whole by name, '
    + 'so an object that passed its own parse could run with two required master_detail fields, or none. The '
    + 'runtime then derives no master: every read of the object is denied and every write refused with 422 '
    + 'INVALID_METADATA, while defineStack, objectstack validate and the security-posture lint said nothing, '
    + 'although they refused the same object declared directly. ObjectStackDefinitionSchema now judges the '
    + 'ADR-0055 §1 rule on the merged field set of every target the stack declares (in a multi-package '
    + 'artifact, any package\'s object), and refuses at the extension\'s fields with the message the declared '
    + 'object gets; the lint reports security-controlled-by-parent-ambiguous-relation or -no-relation at the '
    + 'same extension. A target the stack does not declare is not judged, so an extension of another '
    + 'package\'s object still meets the runtime\'s refusal instead. Not convertible: which master stays, and '
    + 'whether a parent becomes a lookup, are the owner\'s decisions.',
  acceptanceCriteria:
    'defineStack, objectstack validate and objectstack build load the stack with no issue at an '
    + 'objectExtensions entry\'s fields of the form "declares sharingModel \'controlled_by_parent\' with N '
    + 'required master_detail fields" or "but no required master_detail field", and objectstack lint reports '
    + 'neither security-controlled-by-parent rule at an objectExtensions path. At runtime the security plugin '
    + 'logs no "resolves no master relation" line for the extended object, and a member who can read its '
    + 'master reads its rows. An artifact built before 18 that carries the shape is refused at load until it '
    + 'is rebuilt from the corrected source.',
  relevantWhen: { kind: 'stack-declares', keys: ['objectExtensions'] },
};
