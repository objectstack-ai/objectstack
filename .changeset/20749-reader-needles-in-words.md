---
'@objectstack/spec': patch
---

Source comments that cited a tracker number now say in words which decision they mean, and the pin tests that read those comments match the new words

Clause-②: no

The package ships its `src/**/*.zod.ts` sources, and `dist` carries the member docblocks. Four of those texts named a decision only by its tracker number. Each now names the decision in words. The pin test that reads each text matches the new words, at the places the old number stood:

- `ai/build-progress.zod.ts`: the cloud card that ruled the build-progress phase vocabulary in, and that owns where the emitter sits, is now "the cloud build-progress card" in all seven places. The consumer's strict-parse carrier is "block 2 of the objectui build-panel card". The `ai/build-progress` reference page is regenerated from the module docblock, so its description now ends with "(the cloud build-progress card, ruling A)".
- `contracts/approval-service.ts`: the `IApprovalService.continueRestoredRun` docblock says the verb is declared "exactly as the automation-service contract declared" `IAutomationService.cancelRun` / `restoreConsumedSuspension`.
- `ui/notification.zod.ts`: the tombstone note for the removed `./ui` `Notification` / `NotificationConfig` wrappers is labelled `[dual-source removal]`. The `NotificationAction` removal is called "the no-door retirement".
- `ui/sharing.zod.ts`: `EmbedConfigSchema` is recorded as removed "at the no-door retirement (ADR-0049 enforce-or-remove)". The `ui/sharing` reference page is regenerated from the module docblock.

Comments and docblocks only. No key, type, default, accepted value, `.describe()` string or export changes.
