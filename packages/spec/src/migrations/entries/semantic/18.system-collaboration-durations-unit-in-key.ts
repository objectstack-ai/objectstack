// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'system-collaboration-durations-unit-in-key',
  surface: 'the two collaboration-session durations whose name carried no unit: '
    + 'CollaborationSessionConfig.idleTimeout and CollaborationSessionConfig.snapshot.interval '
    + '(system/collaboration.zod.ts)',
  replacement: 'idleTimeoutMs and snapshot.intervalMs — rename each key; both values and the '
    + '300000 idle-timeout default are unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'idleTimeout is the collision that got this whole population ruled rather than merely '
    + 'noted: it is MILLISECONDS here, while the tenant surface carried its own idleTimeout '
    + 'in SECONDS at the same time — so the identical bare name meant five minutes on one '
    + 'shape and three and a half days on the other, a 1000x divergence no parse could catch '
    + 'because both readings are positive integers. The tenant half was already renamed '
    + '(#15626); this is the half that remained. snapshot.interval rides in the same entry '
    + 'because it is the same object graph and the same authoring session — leaving one bare '
    + 'beside the other would have preserved exactly the ambiguity the rename removes. Both '
    + 'are retiredKey() tombstones; the shapes are not strict, so a bare deletion would strip '
    + 'in silence. Why a semantic entry and not a D2 conversion: stack.zod.ts declares no '
    + 'collaboration collection, and a session config is a runtime call argument rather than '
    + 'a stored sys_metadata row, so the conversion chain has no seam that would see it. '
    + '#15679, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every caller that opens a collaboration session spells idleTimeoutMs, and every snapshot '
    + 'block spells intervalMs. Authoring either old spelling fails to compile (input type '
    + '`never`) and fails to parse with the rename prescription. Behaviour is unchanged: '
    + 'idleTimeoutMs: 600000 idles out after ten minutes exactly as idleTimeout: 600000 did, '
    + 'an omitted key still defaults to 300000, and the positive-integer bounds ride along '
    + 'with the renamed keys so a zero or negative interval is still refused. The migration '
    + 'is proved correct when no source in the tree spells a bare idleTimeout on ANY shape — '
    + 'the seconds-valued tenant twin is already gone, so a surviving bare spelling is now '
    + 'unambiguously a missed edit rather than the other key.',
};
