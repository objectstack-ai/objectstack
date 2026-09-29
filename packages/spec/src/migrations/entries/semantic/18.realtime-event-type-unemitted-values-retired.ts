// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The realtime subscription vocabulary moves to the names the runtime emits.
// Semantic only, with no D2 conversion: a subscription is not a stack
// collection member and never a stored row, so no conversion seam would ever
// see one — the refusal on the enum's own error map carries the prescription.
export const entry: SemanticMigration = {
  id: 'realtime-event-type-unemitted-values-retired',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface:
    "api.RealtimeEventType — the values 'record.created', 'record.updated', "
    + "'record.deleted' and 'field.changed' left the enum. It types "
    + 'SubscriptionEvent.type, so it reaches Subscription.events[].type and '
    + 'RealtimeConfig.subscriptions[].events[].type',
  replacement:
    'the names the runtime emits, which are now the whole enum: '
    + "'data.record.created' / 'data.record.updated' / 'data.record.deleted' for "
    + "a single-record write, and 'data.records.updated' / 'data.records.deleted' "
    + 'for a predicate write (multi: true), which carries a count and no record. '
    + "'record.created' becomes 'data.record.created'; 'record.updated' and "
    + "'record.deleted' become their data.record twins, plus the data.records "
    + 'twin where a predicate write must be heard too; '
    + "'field.changed' becomes 'data.record.updated', whose DataEvent payload "
    + 'lists the changed fields in changes',
  reason:
    'ADR-0049 enforce-or-remove. RealtimeEventType was published in the '
    + 'generated API reference as the vocabulary of a realtime subscription, and '
    + 'no producer anywhere emitted any of its four values. What the runtime '
    + 'publishes is the DataEventType / BulkDataEventType vocabulary: the ObjectQL '
    + 'engine sends data.record.created, data.record.updated and '
    + 'data.record.deleted for each written record and data.records.updated / '
    + 'data.records.deleted for a predicate write, and it parses every event '
    + 'through DataEventSchema / BulkDataEventSchema before publishing. A '
    + 'subscription written with the only names the reference showed could '
    + 'therefore never fire, and nothing said so. The direction was settled '
    + 'before this change: the enum moves to the emitted names, and the runtime '
    + "keeps publishing exactly what it published — changing the runtime's live "
    + 'event names to match an enum nothing had ever used would break every '
    + 'real subscriber. field.changed is the same dead spelling that '
    + 'DataEventType already dropped in protocol 17 (the entry '
    + 'data-field-changed-event-retired): no per-field event exists, because an '
    + "update's per-field detail rides on data.record.updated as changes. Metadata "
    + 'change events (metadata.{type}.{action}) were not added: a subscription '
    + 'event is record-shaped (object names a data object, filters narrows '
    + 'records), and metadata events have their own MetadataEventType contract '
    + 'and client primitive. Bookkeeping: an enum VALUE puts nothing in '
    + 'RETIRED_KEYS_BY_MAJOR and leaves the four surface ratchets untouched; its '
    + "prescription hangs on the enum's own error map (the HookBodyCapability "
    + 'precedent). It is a SEMANTIC entry rather than a D2 conversion because '
    + 'there is no source to rewrite: stack.zod.ts has no realtime key, no '
    + 'metadata type holds a subscription, and the open framework mounts no '
    + 'realtime transport that would parse one (maintainer ruling of 2026-09-04: '
    + 'realtime stays out of open core) — so the conversion chain has no seam '
    + 'that would ever see a subscription. ADR-0049 / ADR-0087.',
  acceptanceCriteria:
    "No code or document names 'record.created', 'record.updated', "
    + "'record.deleted' or 'field.changed' as a RealtimeEventType value. "
    + 'TypeScript rejects each one at a RealtimeEventType or SubscriptionEvent '
    + 'position, because the type no longer contains it, and a SubscriptionSchema, '
    + 'SubscriptionEventSchema or RealtimeConfigSchema parse refuses it with its '
    + 'per-value prescription (pinned in api/realtime.test.ts). A subscriber that '
    + 'meant field.changed listens on data.record.updated and reads the field '
    + "from the DataEvent payload's changes map. A handler keyed on an old name "
    + 'never ran, since nothing emitted it, so renaming it changes behaviour only '
    + 'by making it fire.',
};
