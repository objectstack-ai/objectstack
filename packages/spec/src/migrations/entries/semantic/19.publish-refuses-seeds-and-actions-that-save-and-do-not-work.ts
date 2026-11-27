// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the Seeds and actions family of the second batch
// of author-time rules (#35143) that refuse, at publish and in `os validate` /
// `build`, a seed, a flow node or an action the schema still accepts but whose
// work never happens. Notice only: no key is removed and no D2 conversion
// exists, because each fix is a choice only the author can make (which field a
// seed key meant, which object a binding meant, whether a body may write).
export const entry: SemanticMigration = {
  id: 'publish-refuses-seeds-and-actions-that-save-and-do-not-work',
  surface:
    'Three author-time errors, run by the runtime publish gate and by `os validate` / `lint` / `compile` / `build`: '
    + 'a seed record key or seed `columns` key the engine\'s insert door refuses, naming no field of the dataset\'s '
    + 'object, no system column the platform injects on it and none of `id` / `created_at` / `updated_at` '
    + '(`seed-record-unknown-field`); a seed dataset, a flow `get_record` / `create_record` / '
    + '`update_record` / `delete_record` / object-form `screen` node, or a standalone action bound to an object that '
    + 'does not exist (`object-reference-unknown`, a warning `object-reference-unregistered-platform` for a '
    + 'platform-prefixed name no known package registers; the seed binding on the CLI only, because at the publish '
    + 'door the save door already refuses a seed over an unknown object; the flow node a warning on the CLI, where a '
    + 'declared dependency the build cannot see may define the object, and an error at the publish door); an L2 action body that calls a `ctx.api` write without '
    + '`api.write` in its `body.capabilities` (`action-body-write-capability-undeclared`)',
  replacement:
    'Spell the seed key as the field it means, declare the field, or drop the key; point the binding at an object the '
    + 'stack or its artifact defines, an object it extends, or a platform object by its full name; add `api.write` to '
    + 'the action body\'s `capabilities`, or remove the write',
  reason:
    'Each one parses and publishes, then does not work: the seed load refuses a record with a key the engine\'s '
    + 'insert door refuses and loads the rest, so the record is missing at boot; a seed over a missing object loads '
    + 'nothing, a flow step bound to an object no installed package defines fails the run every time it executes, and '
    + 'an action bound to one is carried by no page; the '
    + 'sandbox refuses a body\'s write it was not granted (403 INSUFFICIENT_PRIVILEGES) every time the action reaches '
    + 'it. Stored metadata is not rewritten or refused at boot. The next publish of a seed, flow, action or object '
    + 'that carries one of these is refused with the fix named. An `action` write is also judged for its params\' '
    + '`reference` / `objectOverride` objects, as `os validate` already judged them, and an action saved into a '
    + 'package is judged against that package\'s closure, as a flow saved there already was: an object '
    + 'another package owns resolves only when the manifest declares that package in `dependencies`.',
  acceptanceCriteria:
    'os validate reports none of the three errors; a publish of every seed, flow, action and object the package carries '
    + 'succeeds.',
};
