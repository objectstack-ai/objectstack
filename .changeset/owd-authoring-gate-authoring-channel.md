---
"@objectstack/metadata-protocol": patch
---

Fix: the #3050 pre-persistence authoring gate now keys on the declared `authoringChannel` instead of `environmentId`, so ADR-0090 D11 object posture enforcement reaches host-config deployments.

The gate call site in `saveMetaItem` was wrapped in `if (this.environmentId !== undefined)`. The CLI's lightweight host-config assembler constructs `new ObjectQLPlugin()` with no options, leaving `environmentId` undefined while serving an end-user `PUT /api/v1/meta/*` — so plugin-security's object posture gate (`owd_widening_forbidden` / `owd_external_wider`) ran on no self-hosted deployment at all. This is the same proxy-signal hazard #6710 retired for the sibling #4463 gate; the two doors now read one declared key.

Behaviour change for self-hosted deployments: an object write whose `externalSharingModel` is wider than its `sharingModel` — or an environment overlay that widens a packaged object's OWD — is now refused with `403` (`owd_external_wider` / `owd_widening_forbidden`) on the draft path, the active path and package authoring, instead of being accepted. Fix the posture in the object definition; widening a packaged object legitimately is authored in the package source and published (ADR-0090 D7). A kernel that declares `authoringChannel: 'package-author'` is unaffected — package authoring stays gated at build time by `validateSecurityPosture`.
