// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'session-user-language-retired',
  surface: 'api.session.user.language',
  replacement:
    '`GET /auth/me/localization` → `locale` (the user\'s own `sys_user.locale` when set → '
    + 'the request\'s `Accept-Language` → the deployment default)',
  reason:
    '`SessionUserSchema.language` was declared with a permanent default of `\'en\'` and '
    + 'described as "Preferred language", and had no producer and no consumer anywhere: no '
    + 'session endpoint wrote it, no client read it (objectui measured zero readers at its '
    + 'pinned sha), so a reader trusting the published contract received a constant that was '
    + 'not the user\'s language. Meanwhile the user\'s real preference landed as the '
    + 'first-class column `sys_user.locale` (#13881), which the session type could not see — '
    + 'three spellings of one concept on the published surface, none of them right. The '
    + 'maintainer ruled option D (2026-09-03, #14788): retire the dead key under ADR-0049 '
    + 'enforce-or-remove and make `GET /auth/me/localization` the ONE read face, with its '
    + '`locale` projecting the user column first. This is a RESPONSE surface — the server '
    + 'mints a `SessionUser` and nobody authors or persists one — so there is no source for '
    + 'the chain to rewrite; the schema tombstones the key via retiredKey() and consumers '
    + 'move their read to the endpoint. No replacement field joins the session contract '
    + 'until a session endpoint really produces one (no dual-spelling window, 不渐进). '
    + 'ADR-0049, ADR-0087, #14788.',
  acceptanceCriteria:
    'No client reads `user.language` off a `SessionResponse` / `UserProfileResponse`; a '
    + 'client that seeded its UI language from it now reads `locale` off '
    + '`GET /auth/me/localization`, where a user who set `sys_user.locale` sees that value, '
    + 'a user who did not sees the request\'s `Accept-Language` preference, and a request '
    + 'expressing none sees the deployment default. Constructing a `SessionUser` with '
    + '`language` fails to parse with its own prescription instead of being silently '
    + 'stripped, and assigning it is a `tsc` error at the authoring site.',
};
