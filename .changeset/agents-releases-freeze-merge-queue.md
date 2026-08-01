---
---

Releases nothing — repo process + CI only. `content/docs/releases/` becomes
RELEASE-OWNED (never edited in code PRs; compiled centrally from changesets +
the ADR-0087 registries), AGENTS.md multi-agent §10 scopes the post-merge
re-verify, and the three required-check workflows gain `merge_group:` triggers
so the merge queue can be enabled. No package ships from this change.
