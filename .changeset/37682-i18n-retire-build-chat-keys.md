---
'@object-ui/i18n': patch
---

feat(i18n)!: the 280 translation keys `@object-ui/i18n@18.6.0` shipped for the retired build chat are removed

Clause-②: no
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) The removed operands are translation keys in the published i18n catalogues: no packages/spec schema, registered node type, stored metadata row or ADR-0087 conversion surface names them, and nothing a metadata author writes changes, so there is nothing for objectstack migrate meta to rewrite -->

**BREAKING**: released keys are removed. `@object-ui/i18n@18.6.0` shipped every key listed below; objectstack#37682 retired the build chat that read them (the plan, change and build-result cards, the builder handoff, the Build Doctor drawer, the pending-drafts and spreadsheet-import bars, the maker's start chips and empty state, and Studio's copilot panel), and no code in the platform reads them any more.

If a deployment overrides one of these keys (in its own i18next resources, or a Studio catalogue it registers), that override no longer applies: nothing in the console or Studio asks for the key, so the overriding text is never shown. Remove the override.

The six `console.ai.*Message` keys were the text the plan and change cards sent to the agent, and only `en` and `zh-Hans` carried them. With them gone, the zh-Hant generator no longer has gate-only keys to leave out, so `GATE_ONLY_KEYS` is removed from the package's `scripts/zh-hant.mjs`.

The list is reproduced by `node ui/packages/i18n/scripts/released-keys-removed.mjs` (the tag against this change's tree), minus the keys `origin/main` had already removed.

## Removed translation keys

### Language packs (`@object-ui/i18n`, `@object-ui/i18n/locales`), 271 keys

#### Removed from all eleven locales (209 keys)

Each key below is removed from ar, de, en, es, fr, ja, ko, pt-BR, ru, zh-Hans and zh-Hant.

- `chatbot.build.addingSampleData`
- `chatbot.build.appFallback`
- `chatbot.build.building`
- `chatbot.build.built`
- `chatbot.build.builtAndLive`
- `chatbot.build.checksPassed`
- `chatbot.build.draftPosture`
- `chatbot.build.group.app`
- `chatbot.build.group.dashboard`
- `chatbot.build.group.dataset`
- `chatbot.build.group.object`
- `chatbot.build.group.other`
- `chatbot.build.group.permission`
- `chatbot.build.group.seed`
- `chatbot.build.group.view`
- `chatbot.build.health.sampleRowsLive`
- `chatbot.build.health.sampleRowsLive_one`
- `chatbot.build.health.sampleRowsLive_other`
- `chatbot.build.health.seeds`
- `chatbot.build.health.seeds_one`
- `chatbot.build.health.seeds_other`
- `chatbot.build.health.verified`
- `chatbot.build.health.views`
- `chatbot.build.health.views_one`
- `chatbot.build.health.views_other`
- `chatbot.build.health.widgets`
- `chatbot.build.health.widgets_one`
- `chatbot.build.health.widgets_other`
- `chatbot.build.issuesCount`
- `chatbot.build.issuesDetails`
- `chatbot.build.moreArtifacts`
- `chatbot.build.needsAttention`
- `chatbot.build.needsAttention_one`
- `chatbot.build.needsAttention_other`
- `chatbot.build.nextStepQuote`
- `chatbot.build.nextStepsLead`
- `chatbot.build.unknownPhase`
- `chatbot.build.verified`
- `chatbot.build.verifyStep`
- `chatbot.build.verifying`
- `chatbot.build.warningsSummary`
- `chatbot.changes.kind.app`
- `chatbot.changes.kind.dashboard`
- `chatbot.changes.kind.field`
- `chatbot.changes.kind.object`
- `chatbot.changes.kind.package`
- `chatbot.changes.kind.seed`
- `chatbot.changes.kind.view`
- `chatbot.changes.planTitle`
- `chatbot.changes.planTitle_one`
- `chatbot.changes.planTitle_other`
- `chatbot.changes.reviewAndPublish`
- `chatbot.changes.saveDraft`
- `chatbot.changes.undo`
- `chatbot.changes.undoCancel`
- `chatbot.changes.undoConfirm`
- `chatbot.changes.undoConfirmAction`
- `chatbot.changes.undoConfirmUnknown`
- `chatbot.changes.undoConfirm_one`
- `chatbot.changes.undoConfirm_other`
- `chatbot.changes.undoFailed`
- `chatbot.changes.undoWithOthers`
- `chatbot.changes.undoWithOthers_one`
- `chatbot.changes.undoWithOthers_other`
- `chatbot.changes.undoing`
- `chatbot.changes.undone`
- `chatbot.phase.build`
- `chatbot.phase.design`
- `chatbot.plan.awaitingConfirm`
- `chatbot.plan.buildFailed`
- `chatbot.plan.confirmed`
- `chatbot.plan.countDashboards`
- `chatbot.plan.countDashboards_one`
- `chatbot.plan.countDashboards_other`
- `chatbot.plan.countObjects`
- `chatbot.plan.countObjects_one`
- `chatbot.plan.countObjects_other`
- `chatbot.plan.countSeedData`
- `chatbot.plan.countViews`
- `chatbot.plan.countViews_one`
- `chatbot.plan.countViews_other`
- `chatbot.plan.extendTarget`
- `chatbot.plan.iterateOrNew.buildNew`
- `chatbot.plan.iterateOrNew.extend`
- `chatbot.plan.iterateOrNew.question`
- `chatbot.plan.iterateOrNew.questionUnnamed`
- `chatbot.plan.iterateOrNew.replyHint`
- `chatbot.plan.nameField`
- `chatbot.plan.objectsAndFields`
- `chatbot.plan.suggestedField`
- `chatbot.plan.suggestedFieldLegend`
- `chatbot.plan.views`
- `console.ai.agentLabels.build`
- `console.ai.agentLabels.metadataAssistant`
- `console.ai.askOrChangeApp`
- `console.ai.buildDoctor`
- `console.ai.buildDoctorDisabledTitle`
- `console.ai.buildDoctorDrawer.allLive`
- `console.ai.buildDoctorDrawer.description`
- `console.ai.buildDoctorDrawer.discrepancies`
- `console.ai.buildDoctorDrawer.issueCount`
- `console.ai.buildDoctorDrawer.missingHint`
- `console.ai.buildDoctorDrawer.missingTitle`
- `console.ai.buildDoctorDrawer.noIssues`
- `console.ai.buildDoctorDrawer.notAvailable`
- `console.ai.buildDoctorDrawer.orphanedHint`
- `console.ai.buildDoctorDrawer.orphanedTitle`
- `console.ai.buildDoctorDrawer.pendingActions`
- `console.ai.buildDoctorDrawer.platformNoise`
- `console.ai.buildDoctorDrawer.reconciling`
- `console.ai.buildDoctorDrawer.summary`
- `console.ai.buildDoctorDrawer.timeline`
- `console.ai.buildDoctorDrawer.toolErrorsHint`
- `console.ai.buildDoctorDrawer.toolErrorsTitle`
- `console.ai.buildDoctorDrawer.untitled`
- `console.ai.buildDoctorDrawer.verifyTitle`
- `console.ai.buildDoctorDrawer.yourApp`
- `console.ai.buildDoctorTitle`
- `console.ai.builderHandoffOpen`
- `console.ai.builderHandoffSuperseded`
- `console.ai.builderHandoffTitle`
- `console.ai.changeVerb.addField`
- `console.ai.changeVerb.createMetadata`
- `console.ai.changeVerb.createObject`
- `console.ai.changeVerb.createPackage`
- `console.ai.changeVerb.createSeed`
- `console.ai.changeVerb.deleteField`
- `console.ai.changeVerb.modifyField`
- `console.ai.changeVerb.updateMetadata`
- `console.ai.changesApplied`
- `console.ai.changesApplying`
- `console.ai.changesConfirm`
- `console.ai.changesConfirmHint`
- `console.ai.changesConfirmed`
- `console.ai.changesDrafted`
- `console.ai.changesFailed`
- `console.ai.changesTitle`
- `console.ai.describeAppToBuild`
- `console.ai.designingPlan`
- `console.ai.designingPlanHint.dashboard`
- `console.ai.designingPlanHint.data`
- `console.ai.designingPlanHint.defaults`
- `console.ai.designingPlanHint.finalize`
- `console.ai.designingPlanHint.forms`
- `console.ai.designingPlanHint.lookups`
- `console.ai.designingPlanHint.objects`
- `console.ai.designingPlanHint.relations`
- `console.ai.designingPlanHint.review`
- `console.ai.designingPlanHint.views`
- `console.ai.empty.build.description`
- `console.ai.empty.build.title`
- `console.ai.empty.editApp.askOrChangeDescription`
- `console.ai.empty.editApp.description`
- `console.ai.empty.editApp.title`
- `console.ai.empty.editApp.titleGeneric`
- `console.ai.newApp`
- `console.ai.nextSteps`
- `console.ai.openBuiltApp`
- `console.ai.pendingDrafts.dismissReceipt`
- `console.ai.pendingDrafts.failed`
- `console.ai.pendingDrafts.publish`
- `console.ai.pendingDrafts.publishFromBar`
- `console.ai.pendingDrafts.publishFromBar_one`
- `console.ai.pendingDrafts.publishFromBar_other`
- `console.ai.pendingDrafts.published`
- `console.ai.pendingDrafts.publishedWithFindings`
- `console.ai.pendingDrafts.receipt`
- `console.ai.pendingDrafts.showDraft`
- `console.ai.pendingDrafts.showDraftToPublish`
- `console.ai.pendingDrafts.showDraftToPublish_one`
- `console.ai.pendingDrafts.showDraftToPublish_other`
- `console.ai.planAdjust`
- `console.ai.planApprove`
- `console.ai.planApproveHint`
- `console.ai.planAssumptions`
- `console.ai.planBuilding`
- `console.ai.planBuilt`
- `console.ai.planDeferred`
- `console.ai.planQuestions`
- `console.ai.planReady`
- `console.ai.planTitle`
- `console.ai.previewDraft`
- `console.ai.publishDrafts`
- `console.ai.publishFailed`
- `console.ai.publishOk`
- `console.ai.published`
- `console.ai.seedWarn`
- `console.ai.suggestions.editApp.addDashboard`
- `console.ai.suggestions.editApp.addField`
- `console.ai.suggestions.editApp.addObject`
- `console.ai.suggestions.editApp.addSampleData`
- `console.ai.suggestions.metadataAssistant.buildApp`
- `console.ai.suggestions.metadataAssistant.buildCrm`
- `console.ai.suggestions.metadataAssistant.buildFlow`
- `console.ai.suggestions.metadataAssistant.buildInventory`
- `console.ai.suggestions.metadataAssistant.buildRecruiting`
- `console.ai.switchApp`
- `console.ai.switchAppLabel`
- `console.ai.viewBuiltAppInStudio`
- `excelImport.dismiss`
- `excelImport.importAction`
- `excelImport.importFrom`
- `excelImport.imported`
- `excelImport.imported_one`
- `excelImport.imported_other`
- `excelImport.into`
- `excelImport.noImportableFields`
- `excelImport.opening`
- `excelImport.schemaReadFailed`

#### Removed from ar, es, fr, pt-BR, ru (14 keys)

The other locales never carried these keys (plural slots their languages do not select).

- `chatbot.build.health.sampleRowsLive_many`
- `chatbot.build.health.seeds_many`
- `chatbot.build.health.views_many`
- `chatbot.build.health.widgets_many`
- `chatbot.build.needsAttention_many`
- `chatbot.changes.planTitle_many`
- `chatbot.changes.undoConfirm_many`
- `chatbot.changes.undoWithOthers_many`
- `chatbot.plan.countDashboards_many`
- `chatbot.plan.countObjects_many`
- `chatbot.plan.countViews_many`
- `console.ai.pendingDrafts.publishFromBar_many`
- `console.ai.pendingDrafts.showDraftToPublish_many`
- `excelImport.imported_many`

#### Removed from ar, ru (14 keys)

The other locales never carried these keys (plural slots their languages do not select).

- `chatbot.build.health.sampleRowsLive_few`
- `chatbot.build.health.seeds_few`
- `chatbot.build.health.views_few`
- `chatbot.build.health.widgets_few`
- `chatbot.build.needsAttention_few`
- `chatbot.changes.planTitle_few`
- `chatbot.changes.undoConfirm_few`
- `chatbot.changes.undoWithOthers_few`
- `chatbot.plan.countDashboards_few`
- `chatbot.plan.countObjects_few`
- `chatbot.plan.countViews_few`
- `console.ai.pendingDrafts.publishFromBar_few`
- `console.ai.pendingDrafts.showDraftToPublish_few`
- `excelImport.imported_few`

#### Removed from en, zh-Hans (6 keys)

The other locales never carried these keys (the outbound messages were read from en and zh-Hans only).

- `console.ai.changesConfirmMessage`
- `console.ai.planAnswerMessage`
- `console.ai.planApproveDefaultsMessage`
- `console.ai.planApproveMessage`
- `console.ai.planBuildNewAppMessage`
- `console.ai.planExtendExistingMessage`

#### Removed from ar (28 keys)

The other locales never carried these keys (plural slots their languages do not select).

- `chatbot.build.health.sampleRowsLive_two`
- `chatbot.build.health.sampleRowsLive_zero`
- `chatbot.build.health.seeds_two`
- `chatbot.build.health.seeds_zero`
- `chatbot.build.health.views_two`
- `chatbot.build.health.views_zero`
- `chatbot.build.health.widgets_two`
- `chatbot.build.health.widgets_zero`
- `chatbot.build.needsAttention_two`
- `chatbot.build.needsAttention_zero`
- `chatbot.changes.planTitle_two`
- `chatbot.changes.planTitle_zero`
- `chatbot.changes.undoConfirm_two`
- `chatbot.changes.undoConfirm_zero`
- `chatbot.changes.undoWithOthers_two`
- `chatbot.changes.undoWithOthers_zero`
- `chatbot.plan.countDashboards_two`
- `chatbot.plan.countDashboards_zero`
- `chatbot.plan.countObjects_two`
- `chatbot.plan.countObjects_zero`
- `chatbot.plan.countViews_two`
- `chatbot.plan.countViews_zero`
- `console.ai.pendingDrafts.publishFromBar_two`
- `console.ai.pendingDrafts.publishFromBar_zero`
- `console.ai.pendingDrafts.showDraftToPublish_two`
- `console.ai.pendingDrafts.showDraftToPublish_zero`
- `excelImport.imported_two`
- `excelImport.imported_zero`

### Studio namespace (`@object-ui/i18n/namespaces/studio`), 9 keys

Each key below is removed from both locales the namespace ships: en, zh.

- `engine.studio.aiCopilot`
- `engine.studio.copilot.subject.access`
- `engine.studio.copilot.subject.flow`
- `engine.studio.slot.backToChat`
- `engine.studio.slot.history`
- `engine.studio.slot.openFullPage`
- `engine.studio.slot.pendingCount`
- `engine.studio.slot.planPending`
- `engine.studio.slot.switchHint`
