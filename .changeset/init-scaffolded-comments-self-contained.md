---
"@objectstack/cli": patch
---

`objectstack init` no longer writes ADR identifiers into the user's project (#11023). Five comments rendered by `packages/cli/src/commands/init.ts`'s built-in templates (`app`, `plugin`, `empty`) cited `ADR-0087` and `ADR-0090 D1` — addressed to a reader with this monorepo open. A project scaffolded by `os init` ships no `docs/adr/`, so the identifier named something unfollowable.

Each comment is rewritten self-contained, keeping the rationale it carried, and links a public docs page instead of the internal identifier — the same wording #10324 settled on for `create-objectstack`'s bundled templates:

- protocol compatibility range → https://objectstack.ai/docs/upgrading
- org-wide default (`sharingModel`) → https://objectstack.ai/docs/permissions/sharing-rules
