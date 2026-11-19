// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The connector pull door refuses, at pull time, an input key the read
// action's `inputSchema` does not declare, as the `connector_action` node
// already does: every door that dispatches a connector action judges its input
// alike. A semantic entry and not a conversion: whether a stray key is a
// leftover to drop or a parameter the action's document should declare is the
// author's call — and the watermark parameter the pull adds itself can only be
// declared by the action.
export const entry: SemanticMigration = {
  id: 'connector-pull-undeclared-input-key-refused',
  surface:
    'A `mapping`\'s `connectorSource.input`, and the watermark parameter the pull adds to it as '
    + '`query[watermark.param]`, when the input sent holds a key (at any object level, array items included) '
    + 'that the read action\'s `inputSchema` does not declare at that level.',
  replacement:
    'Drop the key from `connectorSource.input`, or declare it in the action. A key the pull adds itself '
    + 'cannot be dropped from the mapping: for an `openapi` connector, declare the watermark parameter '
    + '(e.g. `since`) as an `in: query` parameter of the read operation in the OpenAPI document. The declared '
    + 'keys are the names in the schema\'s `properties` plus those in `required`, as '
    + '`GET /api/v1/automation/connectors` lists them; a `rest` connector\'s `request` declares `query` with '
    + 'no `properties`, so every query key stays open there.',
  reason:
    'The pull door judged the input against the action\'s `inputSchema` for required parameters and types '
    + 'only, so a key no action reads was sent to the provider while a `connector_action` node with the '
    + 'same input refused it. A pull now fails before the call with VALIDATION_ERROR naming the key and '
    + 'the declared keys. A job\'s scheduled pull has no fault edge, so the refusal fails every run (its '
    + '`sys_sync_run` row ends `failed`) until the mapping or the document is fixed; the watermark parameter '
    + 'is sent only once the target holds a value, so a mapping whose first pull wrote rows fails from its '
    + 'second pull on.',
  acceptanceCriteria:
    'Every `connectorSource.input` holds only keys its read action declares, at every level, and with a '
    + '`watermark` the action declares `watermark.param` in its `query`. Two pulls of the mapping in a row '
    + 'both complete; a pull whose input still holds an undeclared key fails with `code: \'VALIDATION_ERROR\'` '
    + 'naming that key, and the action is never called.',
};
