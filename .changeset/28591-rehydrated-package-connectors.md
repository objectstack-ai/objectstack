---
'@objectstack/service-automation': patch
---

fix(service-automation): a connector an installed package declares is live again after the runtime restarts

Clause-②: no
Metadata-protocol: none

After a restart, the install-local rehydrate registers every installed package again, but in its `kernel:ready` handler. That is after the automation service's boot reconcile in `start()`, and the rehydrate announces no reload. The package was listed by `GET /api/v1/marketplace/install-local` and its flows bound, but its provider-bound connector instances were absent from `GET /api/v1/automation/connectors` until some unrelated metadata reload. Every flow step that called them failed at dispatch.

The automation service now reads the connector declaration once more at `kernel:bootstrapped`, which fires after every `kernel:ready` handler has settled, whatever the plugin order. It reconciles only when that declaration differs from the one the boot reconcile read. A boot that registers no connector after `start()` runs no second reconcile. This reconcile uses reload semantics: a configuration fault in a connector registered during `kernel:ready` (an unknown provider, an invalid `providerConfig`) is logged at `error` and that entry is skipped. It does not fail the boot. This is the same treatment the entry gets when it is installed into a running server.
