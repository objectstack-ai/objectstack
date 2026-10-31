// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// [#24001] ADR-0078's conversion-conflict channel loses its last producer in
// protocol 18 and leaves the published surface with it. Exports and contract
// members only: no metadata document ever carried any of it, so there is no D2
// conversion and no tombstone, and this entry is the declaration.
export const entry: SemanticMigration = {
  id: 'conversion-conflict-channel-removed',
  surface:
    'the ADR-0078 conversion-conflict channel of the ADR-0087 conversion API: the root exports '
    + 'CONVERSION_CONFLICT_CODE, ConversionConflictNotice and ConversionConflictDetail; the '
    + 'onConflict and reservedNodeTypes options of ApplyConversionsOptions (and so of '
    + 'StoredConversionOptions); the reservedNodeTypes and reportConflict members of '
    + 'ConversionContext; the conflicts array of the IAutomationService canonicalizeStoredFlow '
    + 'result (and of the metadata protocol StoredFlowCanonicalization); and the '
    + 'FLOW_CONVERSION_CONFLICT error code, with the HTTP 409 the flow save door, package '
    + 'duplication and the unmanaged package import answered with it',
  replacement:
    '(removed — there is no replacement, because nothing can raise a conversion conflict any '
    + 'more. Delete the onConflict and reservedNodeTypes options from any applyConversions, '
    + 'applyConversionsToFlow or applyConversionsToStoredItem call, delete reads of the '
    + 'conflicts array, and delete any branch on the OS_METADATA_CONVERSION_CONFLICT notice code '
    + 'or on a FLOW_CONVERSION_CONFLICT / 409 response. A conversion reports through emit and, '
    + 'for a site it cannot rewrite losslessly, through the TODO sink (onTodo, '
    + 'ConversionTodoNotice). A rename over an open namespace such as flow node types reserves '
    + 'its old names instead (FLOW_RESERVED_NODE_TYPES): the engine refuses to register an '
    + 'executor or action descriptor under a reserved name, so the refusal happens at '
    + 'registration, loudly, and the stored rename is unconditional)',
  reason:
    'ADR-0049 enforce-or-remove, under the startup-stage rule that a published surface with no '
    + 'producer retires at once. The channel existed for one case: a stored flow whose old '
    + 'HTTP-callout node type (http_request, http_call, webhook) collided with a live executor a '
    + 'plugin registered under that same name, which the callout rename then refused to rewrite '
    + 'and reported as a conflict. Protocol 18 reserved those three names, so the automation '
    + 'engine refuses such an executor and no live owner can exist; the guard inside the rename '
    + 'went with it, and no conversion calls the conflict sink. What stayed published was a '
    + 'live-looking way to report a conflict that nothing can raise: two sink options, a notice '
    + 'type and its code, a contract array that is always empty, and a 409 that no request can '
    + 'trigger — which a client author, or an AI writing one, reads as a failure mode to handle. '
    + 'An upgrader owes a judgment only where their own code branched on it: such a branch was '
    + 'already dead, so deleting it changes no behaviour.',
  acceptanceCriteria:
    'No code imports CONVERSION_CONFLICT_CODE, ConversionConflictNotice or '
    + 'ConversionConflictDetail from @objectstack/spec — each is TS2305 after upgrade, pinned by '
    + 'resolved symbol identity in conversions/conversion-conflict-channel-retirement.test.ts. No '
    + 'call passes onConflict or reservedNodeTypes to a conversion function, and no '
    + 'canonicalizeStoredFlow implementation returns a conflicts array: each is an excess-property '
    + 'tsc error. ErrorCode no longer parses FLOW_CONVERSION_CONFLICT. No metadata document '
    + 'needs editing, and runtime behaviour is unchanged: the conflict branch could not fire, so '
    + 'a stored flow carrying a reserved callout name still loads as http, and a flow save, a '
    + 'package duplication and an unmanaged import answer exactly as before.',
};
