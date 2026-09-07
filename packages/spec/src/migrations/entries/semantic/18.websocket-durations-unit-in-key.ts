// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'websocket-durations-unit-in-key',
  surface: 'the four WebSocket configuration durations whose name carried no unit: '
    + 'WebSocketConfig.reconnectInterval, WebSocketConfig.pingInterval, WebSocketConfig.timeout '
    + 'and WebSocketServerConfig.heartbeatInterval (api/websocket.zod.ts)',
  replacement: 'reconnectIntervalMs, pingIntervalMs, timeoutMs and heartbeatIntervalMs — rename '
    + 'each key; every value is unchanged, and so is every default (1000, 30000, 5000, 30000)',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'What makes this shape worth one entry rather than four is the neighbour: on both configs a '
    + 'bare duration sits directly beside a bare COUNT — maxReconnectAttempts on the client, '
    + 'reconnectAttempts on the server — so `reconnectInterval: 5` and `maxReconnectAttempts: 5` '
    + 'read as the same kind of number and are not. Suffixing the durations separates the two '
    + 'families at the authoring site; the counts keep their names, because a count has no unit to '
    + 'carry. All four are retiredKey() tombstones (neither shape is strict, so a bare deletion '
    + 'would strip in silence). Why a semantic entry and not a D2 conversion: a WebSocketConfig is '
    + 'a client CONNECTION argument and a WebSocketServerConfig is a server CONSTRUCTION argument '
    + '— neither is a stack collection member and neither is ever stored as a sys_metadata row, so '
    + 'the conversion chain has no seam that would see one. The same disposition the '
    + 'epoch-instant renames on this file took (epoch-instant-keys-renamed), and what ruling B '
    + 'prescribes for a key that is not authorable metadata. #15677, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every WebSocketConfigSchema.parse(…) / WebSocketServerConfigSchema.parse(…) site and every '
    + 'literal handed to a WebSocket client or server spells the suffixed keys; authoring any old '
    + 'spelling fails to compile (input type `never`) and fails to parse with the rename '
    + 'prescription. Behaviour is unchanged in every case: a client configured with '
    + '`reconnectIntervalMs: 2000` retries after two seconds exactly as `reconnectInterval: 2000` '
    + 'did, and a config that omits the keys still gets the same defaults. The positive-integer '
    + 'bounds ride along with the renamed keys, so a zero or negative interval is still refused.',
};
