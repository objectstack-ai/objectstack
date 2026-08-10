// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-notification-action-embed-config-retired',
  surface: 'ui.notificationAction / ui.embedConfig',
  replacement:
    '(removed — there is no replacement shape, because there was never a key to write '
    + 'either into. Delete the import and the value. Notification presentation is still '
    + 'described by the surviving `NotificationType` / `NotificationSeverity` / '
    + '`NotificationPosition` vocabulary; public access to a form is granted by the LIVE '
    + '`FormView.sharing` block (`SharingConfig`), which is untouched. Notification action '
    + 'buttons as metadata, and iframe embedding, return via the enforce route of ADR-0049 '
    + 'through a new ADR — carrier key and renderer first, vocabulary second)',
  reason:
    'Both shapes were published `@objectstack/spec/ui` vocabulary with NO AUTHORING DOOR. '
    + '#4001 批 14 measured them three ways on 2026-08-03 and this retirement re-ran all '
    + 'three against `origin/main` before removing anything, each with a positive control '
    + 'that passed in the same run: (1) CARRIER — no schema in `packages/spec/src` declared '
    + 'a key of either type (`ui/notification.zod`\'s only non-test importer was the '
    + 'barrel; `ui/sharing.zod`\'s were the barrel and `ui/view.zod.ts`, which names its '
    + 'SIBLING `SharingConfigSchema`), measured by resolving specifiers rather than '
    + 'substring-matching, because the repo holds two `sharing.zod` modules and a substring '
    + 'test miscredits `stack.zod.ts` to the UI one; (2) REACHABILITY — a BFS from the 24 '
    + 'metadata-type roots plus `defineStack`\'s `ObjectStackSchema`, over '
    + '`build-schemas.ts`\'s own walk including its derived-clone bridge, never reached '
    + 'either, while `Page` / `Action` / `DashboardWidget` / `Webhook` and `SharingConfig` '
    + 'itself all resolved `root-graph` in the same run and an injected synthetic carrier '
    + 'flipped both; (3) PARSE — zero `.parse()` in objectstack, cloud or objectui outside '
    + 'their own unit tests. So nobody could author one and nothing ever validated one: '
    + 'the #3950 shape, an exported schema with no consumer read as a capability, and the '
    + 'ADR-0033 trap where an AI author takes `EmbedConfigSchema` in the published bundle '
    + 'as proof the platform serves iframes. Neither is stored metadata and neither has a '
    + 'carrier, so no `sys_metadata` row can hold one and there is no source for the D2 '
    + 'chain to rewrite; this entry is the D3 record. 批 14 deliberately did NOT close them '
    + 'with `.strict()` — strictness is a property of a PARSE, and closing a shape nothing '
    + 'parses buys only "a precisely-validated dead slot, the more convincing lie" (#4583) '
    + '— and filed the disposition as #5015, ruled REMOVE on 2026-08-04. Each was orphaned '
    + 'by an earlier retirement one level up: `NotificationAction` lost its wrappers at '
    + '#4610 (`NotificationSchema` / `NotificationConfigSchema`, the #4535 C3 dual-source '
    + 'cleanup — that retirement\'s published "zero consumers" evidence was later falsified '
    + 'for objectui and is corrected on `ui/notification.zod`\'s tombstone; the removal '
    + 'itself stands, #5781), and `EmbedConfig` lost its key at 17.0.0 when the 2026-06 '
    + 'liveness audit retired `App.embed` (no iframe route ever read it) — that key still '
    + 'stands as a `retiredKey()` tombstone in `app.zod.ts`, so an author who wrote the KEY already '
    + 'meets a prescription; this removes the value shape that outlived it. ⚠️ The '
    + 'retirement is per SCHEMA, not per file: `ui/sharing.zod` KEEPS `SharingConfigSchema`, '
    + 'a live door carried by `FormViewSchema.sharing` and read by `rest-server.ts` to mount '
    + 'the anonymous form routes, and `ui/notification.zod` keeps its three presentation '
    + 'enums. objectui consumed `NotificationActionSchema.shape.variant` as a VOCABULARY '
    + '(never a parse) to pin its own hand-written `NotificationActionButton` interface — '
    + 'which is exactly why "has a consumer" never meant "has an authoring door" here; that '
    + 'pin is adapted objectui-side when it refreshes this dependency. ADR-0049, #5015.',
  acceptanceCriteria:
    'No code imports `NotificationActionSchema`, `NotificationAction`, `EmbedConfigSchema` '
    + 'or `EmbedConfig` from `@objectstack/spec` or `@objectstack/spec/ui` — both are '
    + 'TS2305 after upgrade, on every public entry (pinned by resolved symbol identity in '
    + '`notification-embed-retirement.test.ts`). The same pin asserts the SURVIVORS in the '
    + 'same run, and that half is equally load-bearing: `NotificationTypeSchema` / '
    + '`NotificationSeveritySchema` / `NotificationPositionSchema` and `SharingConfigSchema` '
    + 'must still be exported from `./ui`, and both modules must still load — a retirement '
    + 'that deleted either file would satisfy the absence half while destroying working '
    + 'surface. Nothing regresses at runtime, because nothing ever ran: no notification '
    + 'action was ever parsed from metadata and no iframe route ever read an embed config. '
    + 'Public form sharing is unaffected — `FormView.sharing` still gates the anonymous '
    + 'endpoints on `allowAnonymous` + `publicLink`.',
};
