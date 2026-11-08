---
'@objectstack/plugin-webhooks': patch
'@objectstack/plugin-email': patch
'@objectstack/service-automation': patch
---

feat: webhooks, declared connector instances and email templates resolve their names by (package, name) through the shared package-scoped resolver (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

Which declared webhook a name dispatches, which declared connector instance a name materializes and which email template a send renders are now answered by `resolvePackageScopedName` from `@objectstack/objectql`, never by list order. Every one of these readers is context-free (a send names no package, the dispatcher and the connector reconcile read the whole environment), so each asks as a caller with no package: the environment's own item, else the unique package holder (the email service's built-in templates rank below an app's), else a refusal that names every candidate.

Who is affected: nobody today. Phase 1's one-holder refusal still holds for all three types, so no two installed packages can ship the same webhook, connector or email template name, and every name resolves exactly as before. Once a type's backstop narrows (its own later release), a name two packages ship is refused instead of silently taking the first one:

- a declared webhook is not dispatched, the refusal is logged once naming both packages, and the by-name reads (activation door, redelivery veto, name guard) answer a `409 RESOURCE_CONFLICT` naming them instead of "not declared";
- a declared connector instance is not materialized, and boot fails naming both packages, as it already did for a duplicate instance name;
- an email template send fails with a `409 RESOURCE_CONFLICT` naming both packages.

The three packages now depend on `@objectstack/objectql` at runtime (it was a dev dependency).
