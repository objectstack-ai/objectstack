// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #32666, ruled letter A. An accept-set narrowing of the runtime object write:
// the publish gate judges the written package's live flows against the object
// with `flow-update-readonly-field` (and `-when`), and refuses the object write
// for a conflict it adds. No D2 conversion: whether the flow is elevated, the
// field stays writable, or the write moves to a hook is the author's call.
export const entry: SemanticMigration = {
  id: 'object-readonly-field-written-by-live-flow-refused',
  surface:
    'an object published at runtime (package publish or a live save) that makes a field readonly while a live '
    + 'flow of the same package writes it from an update_record or create_record node and does not run as '
    + 'system — e.g. fields: { status: { type: \'select\', readonly: true, ... } } with a live flow whose node is '
    + '{ type: \'update_record\', config: { objectName: \'leave_req\', fields: { status: \'pending\' } } }',
  replacement:
    'Before making the field readonly, publish the flow with runAs: \'system\' (a button or action starts an '
    + 'elevated flow only as a screen or api flow, or through a subflow node), or remove the field from the '
    + 'flow\'s node, or keep the field writable. A field made readonlyWhen publishes with the '
    + 'flow-update-readonly-when-field advisory instead; derive its value in a beforeUpdate hook. Objects whose '
    + 'readonly fields no live user-run flow writes, and conflicts already on the tenant before this write, are '
    + 'unchanged.',
  reason:
    'A runAs:\'user\' flow that writes a readonly field is a silent no-op at run time: the engine strips the '
    + 'field and the step still reports success, so the button the flow backs changes nothing and says nothing. '
    + 'A flow write was already refused for it, but the reverse order passed: the flow went live while the '
    + 'field was writable, then the object made it readonly. The object publish now carries the package\'s '
    + 'live flows into the same judgement and refuses with INVALID_METADATA (422), naming the flow and node '
    + 'that still write the field; only conflicts this write adds are charged. Not convertible: which of the '
    + 'remedies fits is a fact only the author holds.',
  acceptanceCriteria:
    'Publish the package: no object is refused with flow-update-readonly-field. Then run each button or '
    + 'automation that updates a readonly field and confirm the record changes.',
};
