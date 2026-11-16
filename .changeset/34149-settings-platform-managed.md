---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): on a cloud-managed environment, Setup's File storage page and the AI provider part of the AI page say the platform manages them

Clause-②: no
Metadata-protocol: none

A direct route (a bookmark or a typed URL) to Setup → File storage on a cloud-managed environment used to draw the generic load error, because the server refuses that namespace there. The console now reads that refusal by its declared shape (`409 RESOURCE_CONFLICT` with `error.details.managedBy: 'platform'`) and draws "Managed by the platform" with no form and no retry. A `409` without `managedBy: 'platform'` keeps the error card.

The AI page is served without its provider, model and credential keys on a cloud-managed environment. When the served auth config says the environment is cloud-managed (`features.cloudManaged`) and the served page carries no `provider` key, the page draws one line saying the platform manages the AI provider; the conversation-title and observability settings stay editable. A save or an action the server refuses as platform-managed (a page loaded earlier) toasts the same managed text instead of the server's sentence.

Self-hosted environments are unchanged. Three new keys under `console.settingsView` in every `@object-ui/i18n` pack: `platformManagedTitle`, `platformManagedBody`, `aiProviderManaged`.
