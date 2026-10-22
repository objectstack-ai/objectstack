// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0015 §4.2 enforced: `object.external` only on a datasource whose
// `schemaMode` is not 'managed'. The record declared the rule "enforced at
// metadata-load time" and no load door enforced it. A structured TODO, not a D2
// conversion: deleting `external`, renaming the object's `datasource` or
// re-declaring the datasource `schemaMode: 'external'` each says a different
// thing about where the rows live, and which one is true is the owner's
// knowledge, which no artifact records.
export const entry: SemanticMigration = {
  id: 'object-external-binding-managed-datasource-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'object.external together with object.datasource — an external (federated) binding on the platform\'s '
    + 'primary datasource (datasource \'default\', also the value when none is written) or on a datasource '
    + 'the same stack declares with schemaMode \'managed\' (or no schemaMode, which is managed by default)',
  replacement:
    'Name, in the object\'s own `datasource`, the datasource that holds the remote table, and declare that '
    + 'datasource with `schemaMode: \'external\'` (or `\'validate-only\'`) and its `external` settings. An object '
    + 'whose rows ObjectStack should own instead drops `external` and stays managed. `ObjectSchema` refuses an '
    + '`external` binding whose object `datasource` is `\'default\'` at parse, so `ObjectSchema.create()`, '
    + '`defineStack`, `os validate` and the object save door (`422 INVALID_METADATA`) refuse it; `defineStack` '
    + 'refuses one on a managed datasource the same stack declares with `STACK_CROSS_REFERENCE_INVALID`. A '
    + 'package `defaultDatasource` or a `datasourceMapping` rule does not make an object federated: they route '
    + 'its queries, while the boot validation and the write gate read the object\'s own `datasource`.',
  reason:
    'ADR-0015 §1 makes an object federated by the datasource it points to, and §4.2 allows `object.external` '
    + 'only when that datasource\'s `schemaMode` is not \'managed\', declared "enforced at metadata-load time". '
    + 'No load door enforced it: `defineStack`, `os validate` and the object save door accepted an `external` '
    + 'binding on a managed datasource, `default` included. The runtime then disagreed with itself about the '
    + 'object. Its schema sync treats any object carrying `external` as federated and never creates its table, '
    + 'while the boot validation skips it as "not federated" and the write gate exempts it because its datasource '
    + 'is managed. So the object booted with no table and nothing judged it. The rule is enforced where each half '
    + 'is visible: the object alone shows a binding on `default`, the platform\'s managed primary; a stack that '
    + 'declares the named datasource shows its `schemaMode`. A datasource the door cannot see (one a host or '
    + 'another package registers, or one stored at runtime) gets no verdict at these doors. No mechanical move '
    + 'is lossless: dropping `external` turns a remote table into a table ObjectStack creates, and pointing the '
    + 'object at another datasource or re-declaring the datasource external are statements about where the rows '
    + 'live that only the owner can make. Measured at the change: the one in-tree producer, the showcase\'s '
    + 'federated objects, names `showcase_external`, declared `schemaMode: \'external\'`; the federation import '
    + 'already refuses a managed datasource; no template, CLI scaffold or published skill writes the refused shape. '
    + 'ADR-0015 / ADR-0087.',
  acceptanceCriteria:
    'Load every object module (`os validate` or `os build`): no object is refused with "declares `external`, but '
    + 'its `datasource` is \'default\'" or "declares `external` on datasource …, whose `schemaMode` is \'managed\'". '
    + 'Every object carrying `external` names, in its own `datasource`, a datasource whose definition declares '
    + '`schemaMode: \'external\'` or `\'validate-only\'`, and `GET /api/v1/datasources` reports that schemaMode for '
    + 'it. A stored object row in the refused shape still registers, with its `[metadata_spec_invalid]` '
    + 'diagnostic, and its next save is refused until it is corrected; `os migrate meta --stored` lists each such '
    + 'row under this entry\'s id. Done when every federated object passes the boot validation against its '
    + 'remote table and every other object has no `external`.',
};
