---
"@objectstack/spec": minor
---

ADR-0019 P2 — manifest two-tier + consumer-App rules (warn-only draft).

Adds `CONSUMER_INSTALLABLE_TYPES` and `isConsumerInstallable(type)` to express
the package-type tier split (D2: only `app` is consumer-installable), and a new
`consumer-app-rules` module with `validateConsumerAppPurity` (D6) and
`validateRequiresShape` (D7). `defineStack()` runs both as **non-blocking
warnings** — existing apps that bundle code still build; the Marketplace publish
path will later treat these as errors for consumer `type: app` listings. No
runtime/registry changes (capability registry + install gate remain P4).
