---
'@objectstack/skills': patch
---

docs(skills): objectstack-upgrade says a stored row in a ≤16.x shape stops being rewritten at read on 18.3, and teaches the stored pass on 18.2 or earlier first

Clause-②: no
Metadata-protocol: none

- **Before.** § "Stored rows" said every stored-row rehydration replays the conversion chain including entries retired from the load path, so "a row written under protocol 16 therefore rehydrates in its protocol-17 shape without anybody editing it", and offered `os migrate meta --stored --apply` only as a way to make that durable. § 3.6 called the read-time rehydration "still the guarantee", the report template marked the stored pass optional ("rows rehydrate correctly today"), and eval 4 expected the same answer. On 18.3, which drops every conversion retired at or below 16.x, that advice leaves such a row unconverted for good.
- **Now.** The section says rehydration replays only the conversions the installed release still carries, that 18.3 drops those retired at or below 16.x, and to run the stored pass on the release being left (18.2 or earlier for such a row) before moving; § 3.6 says the `os migrate meta --stored --json` exit `0` counts only on the release being left, because one that dropped a row's conversions answers `0` without recognising the row; the report template's stored-pass line says it is owed before any release that drops the rows' conversions. Eval 4's expected answer says the same, and new eval 5 asks the 18.1 → 18.3 question directly.
- `SKILL.md` and `references/examples-upgrade.md` stay under their token ceilings (no ceiling moves). No schema, key, command or behaviour changes.
