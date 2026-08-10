// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'hook-context-session-roles-retired',
  surface: 'data.hookContext.session.roles',
  replacement:
    '(removed — gate on `session.userId` / `session.isSystem`; for PRIVILEGE ask the '
    + 'security service, which reads `permissions` / `positions` / posture off the '
    + 'execution context, ADR-0095 D3)',
  reason:
    'Declared on the runtime hook context, read by exactly two consumers, produced by '
    + 'nobody. The two readers were the approvals record lock and the delegation write '
    + 'guard, each opening with `session.roles?.includes(\'admin\')`; ObjectQL\'s '
    + '`buildSession()` builds the session field by field and has never written `roles`, '
    + 'and nothing else feeds a HookContext in objectstack, cloud or objectui (cloud\'s hook '
    + 'consumers read `hookContext?.session?.userId`; objectui\'s `roles` are the '
    + '`/auth/me` user payload, a different surface; an ACTION body\'s `ctx.session` is a '
    + 'different untyped object that does carry `roles`, tracked apart and unaffected). '
    + 'Both branches were therefore dead on '
    + 'every real engine path — an authorization decision in shape only, and a second admin '
    + 'dialect competing with the one ADR-0090 D3 / ADR-0095 D3 sanction. #4839 (PR #5049) '
    + 'removed the readers; this removes the declaration, per ADR-0049 enforce-or-remove. '
    + 'This is a RUNTIME context, not stored metadata: the engine builds a HookContext per '
    + 'operation and nothing persists one, so no `sys_metadata` row, example or template '
    + 'can carry the key and there is no source for the D2 chain to rewrite — the '
    + '`openApi31` (#4579) / `activationEvents` (#4657) shape, one semantic TODO rather '
    + 'than a stack conversion. The key IS tombstoned (`HookContextSchema` is deliberately '
    + 'not `.strict()` — a plain delete would strip it silently, #3733 / ADR-0104), so a '
    + 'consumer that parses a context it was handed still meets the prescription. '
    + 'ADR-0049, #5050.',
  acceptanceCriteria:
    'No hook reads `ctx.session.roles`; caller gating uses `ctx.session.userId` / '
    + '`ctx.session.isSystem`, and privilege comes from the security service '
    + '(`permissions` / `positions` / posture). Constructing a HookContext session with '
    + '`roles` fails `tsc` (the input type is `never`) and fails `HookContextSchema.parse` '
    + 'with the retirement prescription instead of being silently stripped. Nothing '
    + 'regresses at runtime: the key had no producer, so no decision anywhere ever saw a '
    + 'value in it.',
};
