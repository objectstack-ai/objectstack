---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a dismissed or revoked default permission set in the suggested-bindings panel can be reconsidered (#30199)

Clause-②: no
Metadata-protocol: none

The suggested-bindings panel (the install dialog and Marketplace package page, and Studio's Access pillar) drew a dismissed suggestion, or a revoked acceptance, as a state line with no action. An administrator who chose Dismiss could only take it back by calling `POST /api/v1/security/suggested-bindings/:id/reopen` by hand, although the server has offered that door all along.

Such a row now offers "Reconsider". It calls the re-open door, and the row comes back as a pending suggestion with Accept and Dismiss (a Guest row with Dismiss only, as before). Re-opening grants nothing: the set reaches the Everyone position only when it is accepted again, under the same checks. The button is shown to the same callers who see Accept and Dismiss: a caller without `manage_metadata` is refused the list and sees no panel. A refusal (the row is gone, the set is no longer suggested, or the deployment's security service has no re-open door) is shown with the server's own message, and the panel re-reads the list.

New client call: `reopenSuggestedBinding(id)`, beside `dismissSuggestedBinding`. New strings: `marketplace.suggestedBindings.reopen`, `.reopening` and `.reopenedToast` in all ten locale packs, and `engine.studio.access.suggestReopen`, `.suggestReopening` and `.suggestReopenedToast` (en, zh).
