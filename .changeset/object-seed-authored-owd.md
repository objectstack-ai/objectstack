---
'@objectstack/spec': patch
---

`METADATA_CREATE_SEEDS.object` now authors its org-wide default explicitly (`sharingModel: 'private'` — the value the runtime already resolves an absent OWD to, ADR-0090 D1). A freshly created object from the Studio designer, CLI or API create flows carries the authored baseline instead of relying on the implicit fail-closed default; effective sharing is unchanged. This is blocker A of the #7891 strictness rollout: it lets `security-owd-unset` move onto the runtime publish surface without refusing the platform's own minimal create body.
