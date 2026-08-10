// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'data-field-changed-event-retired',
  surface: "api.DataEventType 'data.field.changed'",
  replacement:
    "the `data.record.updated` event, whose payload already carries the per-field "
    + 'detail: `changes` (the changed fields), plus `before` / `after`',
  reason:
    '`data.field.changed` was declared in `DataEventType` and emitted by nothing — the '
    + 'engine\'s `publishDataEvent` sends `data.record.{created,updated,deleted}` and (since '
    + '#4639) `data.records.{updated,deleted}`, and no other producer exists in either '
    + 'repository. A subscriber that switched on it was waiting on an event no producer '
    + 'sends: the branch never ran, and because the surrounding `switch` still compiled, '
    + 'nothing anywhere reported the gap (ADR-0078\'s silently-inert declaration, on the '
    + 'event vocabulary). `DataEventSchema` could not have carried the semantics even if '
    + 'something had emitted it — the payload is record-shaped (`recordId`, `changes`, '
    + '`before`, `after`) with no `field` / `oldValue` / `newValue` slot — so the member '
    + 'promised a granularity the contract has no room for. Per-field detail is therefore '
    + 'not lost: it has always ridden on `data.record.updated` as `changes`, which is one '
    + 'event per write rather than N events on a wide table. This is a runtime EVENT '
    + 'surface — no stack, example or template authors an event name (webhooks subscribe '
    + 'through the separate authorable `WebhookTriggerType`, whose vocabulary was already '
    + 'trimmed to producers that exist, #3196) — so there is no source for the chain to '
    + 'rewrite, and deliberately no schema tombstone: a removed ENUM MEMBER cannot carry a '
    + 'retiredKey() fix-it error the way an authorable object key can (the same limit the '
    + 'sharing-rule `full` retirement hit above). The enforced channels are tsc, which '
    + 'fails any consumer still naming the value in a `DataEventType` position, and the '
    + 'enum parse, which now rejects the name instead of accepting an event that never '
    + 'arrives. A genuine per-field stream, if one is ever wanted, gets its own honest '
    + 'contract the way #4639 gave bulk writes theirs. ADR-0049 / ADR-0078, #4673.',
  acceptanceCriteria:
    'No consumer subscribes to or switches on `data.field.changed`; per-field change '
    + 'detail is read from a `data.record.updated` event\'s `changes` map (with `before` / '
    + '`after` for the surrounding state). Deleting the dead branch changes no observable '
    + 'behaviour — it never executed — so the migration is removing code that could not '
    + 'run, not rebuilding a capability.',
};
