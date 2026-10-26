---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills, spec): state that every published package declares exactly one anchor-safe `isDefault: true` permission set

Clause-②: no
Metadata-protocol: none

`objectstack-data/rules/security.md` said what `isDefault: true` means (the `everyone` baseline, ADR-0090 D5) but not that a published package must declare one. Its `isDefault` bullet now states the requirement as a check an author can run: exactly one such set, anchor-safe, meaning `describeAnchorForbiddenBits(set, 'everyone')` from `@objectstack/spec/security` returns `null`; otherwise lint rule `security-anchor-high-privilege` and the binding refuse it. It also says what happens without one (invited members get nothing until an admin assigns a set to each) and that no gate counts the sets. The Marketplace Protocol header in `marketplace.zod.ts`, which the generated marketplace reference page renders, gains a matching "What a published package declares" section. No lint rule or schema changes. To stay within the skill file's token ceiling, three source-path asides, a section reference and one sentence are trimmed in the same file.
