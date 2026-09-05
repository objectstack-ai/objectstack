// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'epoch-instant-keys-renamed',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'four epoch-instant keys whose name carried no unit: '
    + 'WebSocketEvent.timestamp, SimplePresenceState.lastSeen, '
    + 'KernelContext.startTime (inherited by TenantRuntimeContext) and '
    + 'HealthStatus.timestamp',
  replacement:
    'the same instants named for what they mark and typed with the new shared '
    + 'EpochMs schema (shared/epoch.zod.ts): occurredAt, lastSeenAt, startedAt '
    + 'and checkedAt. The VALUE is unchanged in every case — still '
    + 'milliseconds since the Unix epoch, still Date.now(). Only the key name '
    + 'and the declared schema move',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): a '
    + 'duration-shaped z.number() carries its unit in the key NAME, minus two '
    + 'structural classes declared ON THE SCHEMA rather than in a gate ledger. '
    + 'Epoch instants are the first class. They read to the rule exactly like '
    + 'an offending duration — a bare name plus a describe that says '
    + '"milliseconds" — but renaming them the way the rule prescribes would '
    + 'resolve the wrong confusion: measured on this package own authorable '
    + 'surface, all 51 distinct keys ending in Ms are durations (timeoutMs, '
    + 'backoffMs, latencyMs, uptimeMs) and all 51 distinct keys ending in At '
    + 'are instants (createdAt, expiresAt, lastUsedAt). Spelling an instant '
    + 'with the Ms suffix would move it INTO the duration family. So the '
    + 'exemption is a declaration on the contract: the value becomes EpochMs, '
    + 'which states the epoch-millisecond unit once, and the key takes this '
    + 'package established At convention. Two of the six instants ruling B '
    + 'names (ServiceMetadata.registeredAt and ScopeInfo.createdAt) were '
    + 'already correctly named and only changed schema, so they are not '
    + 'retirements and appear in no table. A SEMANTIC entry rather than a D2 '
    + 'conversion because all four keys are RUNTIME-EMITTED — a WebSocket '
    + 'event and a presence payload are wire messages, a kernel context is '
    + 'constructed by host code at boot, a health report is emitted by the '
    + 'startup orchestrator — so none is ever stored as a sys_metadata row and '
    + 'the conversion chain has no seam that would see one. That is the same '
    + 'disposition kernel/KernelContext:previewMode already carries on one of '
    + 'these very defs, and ruling B prescribes it explicitly: an ADR-0087 '
    + 'conversion where the key is authorable, a semantic entry where it is '
    + 'runtime-emitted. #15676, #14478, ADR-0087.',
  acceptanceCriteria:
    'No producer emits the old key and no consumer reads it. All four are '
    + 'tombstoned with retiredKey(), so each fails tsc at the construction '
    + 'site (the key types never) and fails the parse with the rename '
    + 'prescription. Concretely, check four places. (1) Code building a '
    + 'WebSocketEvent: rename timestamp to occurredAt. (2) Code building a '
    + 'SimplePresenceState: rename lastSeen to lastSeenAt — and note that the '
    + 'neighbouring PresenceState.lastSeen (api/realtime-shared.zod.ts) is a '
    + 'DIFFERENT key holding an ISO-8601 datetime string, which is untouched '
    + 'and must not be renamed with it. (3) Host boot code composing a '
    + 'KernelContext or a TenantRuntimeContext: rename startTime to startedAt. '
    + '(4) Code building a kernel HealthStatus: rename timestamp to checkedAt. '
    + 'In every case the value is carried across unchanged. One behavioural '
    + 'note: WebSocketEvent.timestamp and SimplePresenceState.lastSeen were '
    + 'declared z.number() with no integer constraint and EpochMs is '
    + 'z.number().int(), so a fractional epoch that used to parse is now '
    + 'refused at those two sites — a tightening, and Date.now() has always '
    + 'satisfied it.',
};
