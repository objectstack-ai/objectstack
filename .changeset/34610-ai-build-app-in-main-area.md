---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

feat(console-ai): an AI build shows the app itself in the main area, with one Publish on screen

Clause-②: yes (widening — new @object-ui/i18n locale keys, so `TranslationKeys` grows; and two additive @object-ui/plugin-chatbot changes, the optional `ChatbotEnhanced` prop `publishFromShellBar` and the optional `opts.appSegment` argument of `onBuildMaterialized`); nothing removed or renamed
Metadata-protocol: none

Building with AI happens in the console's right-side drawer, and the app it builds shows in the page beside it (ui ADR-0057 Amendment A3, ADR-0037 as amended). There is no nested preview any more.

- Changes to a published app show on the page you are on, in draft mode, with the draft bar on top. A new app shows in the main area once the build creates its package. Before that, the page stays. A new app is materialized (ADR-0045), so it shows as the real, not-yet-published app. The main area refreshes as each drafted item lands, and once more when the build's turn ends. Opening an older conversation from the history does not move the page.
- The screen has one Publish: the draft bar, or the "not published yet" bar for an app that has never been published. The chat's result cards and the line above the composer no longer publish. The line says where to publish, or offers "Show draft" when the page is elsewhere. After a publish from the bar, the chat shows a receipt.
- One count: the draft bar, its changes panel and the chat all count the current app's pending changes. An app's changes are those in its package and in its customization package (ADR-0146), where changes to an app installed from code are saved. The bar no longer counts the whole environment, and its separate "on this page" count is gone. Publishing from the draft bar publishes that app's changes and no longer reloads the page.
- Publishing from the "not published yet" bar works for an app opened at its package id: the app is saved under its own name. Before, that save was refused.
- The bar for an app that is not published yet says so. The draft bar says how many unpublished changes the app has.
- In Studio, the AI copilot's expand button widens the copilot beside the page instead of leaving Studio. The copilot's cards no longer draw a Preview or Publish of their own. Studio's own top bar publishes.

`@object-ui/console`: ships the console with the changes above (it bundles `@object-ui/app-shell`).

`@object-ui/plugin-chatbot`: `ChatbotEnhanced` takes `publishFromShellBar`. When it is set, the draft cards draw no Publish button, and the build result card no longer says to click Publish in the chat. The Published badge, auto-publish and Preview stay. `onBuildMaterialized` also receives `{ appSegment }`, the built app's package id.

`@object-ui/i18n`: new keys `preview.draftBar.pendingInApp` (with plural forms), `preview.unpublishedBar.notPublishedYet`, and `console.ai.pendingDrafts.publishFromBar`, `showDraftToPublish` (both with plural forms), `showDraft`, `receipt` and `dismissReceipt`, in every locale pack, so the `TranslationKeys` type grows by those keys. No key was removed or changed. The console no longer reads `preview.draftBar.pendingHere`, `preview.unpublishedBar.message`, `console.ai.pendingDrafts.count`, `publish`, `published`, `failed`, `publishedWithFindings`, `console.ai.previewApp`, `console.ai.resizeSplit`, `console.ai.liveCanvas`, `console.ai.liveCanvasLive` or `console.ai.liveCanvasUnlisted`. Retiring them is a separate change.
