---
"@object-ui/console": patch
"@object-ui/components": patch
"@object-ui/i18n": patch
---

Clause-②: no
Metadata-protocol: none

More console surfaces now speak the session's language (objectui#13460, second pass). System → Audit Log, Developer → Flow Runs, the Integrations page's "Connect an AI agent" card, the share-link dialog and the public `/s/:token` share landing drew their copy as English literals. They now read `console.system.auditLog.*`, `console.developer.flowRuns.*`, `console.developer.agentConnect.*`, `shareDialog.*` and `sharedRecord.*`, each with an `en` inline default and a row in all ten packs. A sentence that names another control names it by that control's translated label, and a sentence with inline code is one translated string. Error states are kept as codes and worded at render.

The dev-only surfaces moved under `dev/`: `PerformanceDashboard` to `apps/console/src/dev/`, and the components package's `debug/` folder (the `DebugPanel`) to `dev/`. The package's exports are unchanged.
