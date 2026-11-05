---
'@object-ui/console': patch
---

fix(console): a settings action whose handler declares `confirmText` asks before it runs

Clause-②: no
Metadata-protocol: none

The settings manifest's action handler (`SpecifierHandlerSchema`, its `http` and `action` arms) declares `confirmText`: "Confirm dialog text before invoking (omit = no confirm)". The Console's `action_button` row never read it, so an action its manifest marked as needing a confirmation ran on the first click. Now a declared `confirmText` opens a confirmation dialog carrying that text (translated through `settings.NAMESPACE.actions.ID.confirmText` when the locale has it); Cancel runs nothing and Continue runs the action once. A handler without `confirmText`, and a `navigate` handler, runs on click exactly as before.
