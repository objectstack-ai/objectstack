---
"@objectstack/spec": major
---

release!: promote the accumulated launch-window train to v17.0.0 (RC cycle)

Anchor changeset for the v17 major. The lockstep group applies the highest
bump across all pending changesets to every package, so this single `major`
promotes the whole train — every other pending changeset keeps its own
`minor`/`patch` declaration and its own narrative.

**Why a major, when the launch-window policy ships breaking changes as
`minor`:** this train's breaking density is the highest since the policy was
adopted — the `ApiMethod` enum shrink (#3543, compile-time breaking for TS
authors), the GraphQL surface removal, the ADR-0104 field value-shape write
cutover, and the retirement of several dead spec clusters all ride together.
Publishing that set as a bare minor would auto-upgrade every `^16.x` consumer
into it on their next install. A major puts the version-number signal back:
caret ranges hold at 16.x until a consumer opts in.

**RC cycle:** this lands inside Changesets pre-mode (`rc` tag), so the train
publishes as `17.0.0-rc.N` — nothing reaches `latest` until `changeset pre
exit`. Downstream validation during the RC window: cloud / objectui /
examples upgrade against the RC, the dogfood gate and the third-party
consumer gate (#2035) run against it, and legacy `apiMethods` strip warnings
are watched for the deny-all cliff.

Migration: each breaking change's own changeset carries its FROM → TO guide
(grep the CHANGELOG for `!:` entries); the ApiMethod shrink additionally
ships a reporter codemod (`scripts/codemod/apimethods-legacy-to-primitives.mjs`).
