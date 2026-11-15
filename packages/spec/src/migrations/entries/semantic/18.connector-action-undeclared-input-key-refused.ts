// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A `connector_action` node refuses, at run time, an input key the chosen
// action's `inputSchema` does not declare, instead of sending it to the
// provider. A semantic entry and not a conversion: whether a stray key is a
// leftover to drop or a sign the wrong action is picked is the author's call.
export const entry: SemanticMigration = {
  id: 'connector-action-undeclared-input-key-refused',
  surface:
    '`flow.nodes[].connectorConfig.input` of a `connector_action` node, when it holds a key (at any object '
    + 'level, array items included) that the action\'s `inputSchema` does not declare at that level.',
  replacement:
    'Drop the key from `connectorConfig.input`, or pick the action that declares it. The declared keys '
    + 'are the names in the schema\'s `properties` plus those in `required`, as `GET /api/v1/automation/connectors` lists them. '
    + 'For a parameter the provider takes that the action does not list (Slack `chat.postMessage` / `chat.update` list four '
    + 'each), use the connector\'s pass-through action: Slack `call` with `method` and `params`.',
  reason:
    'Every shipped connector input schema leaves `additionalProperties` unset, so under JSON Schema\'s '
    + 'open default a key no action reads passed the input check and reached the provider. A connector or '
    + 'action switch in the designer is how such a key is left behind. The step now fails before dispatch '
    + 'with VALIDATION_ERROR naming the key and the declared keys; a schema that admits more keys '
    + '(`additionalProperties` true or a schema, `patternProperties`, a composition keyword) or lists no '
    + '`properties` still dispatches every key.',
  acceptanceCriteria:
    'Every `connector_action` node\'s `connectorConfig.input` holds only keys its action declares, at every '
    + 'level, and a run of the flow dispatches the step. A step whose input still holds an undeclared key '
    + 'fails with `code: \'VALIDATION_ERROR\'` naming that key, and the provider is never called.',
};
