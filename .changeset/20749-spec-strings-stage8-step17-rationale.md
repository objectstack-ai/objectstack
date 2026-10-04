---
'@objectstack/spec': patch
---

The protocol 16 → 17 upgrade rationale no longer cites tracker numbers; each cited decision is stated in words

Clause-②: no

`MIGRATIONS_BY_MAJOR[17].rationale` in `@objectstack/spec` is the prose an author reads when upgrading metadata from protocol 16. `os migrate meta` prints it for each hop, and `docs/protocol-upgrade-guide.md` reproduces it word for word under "Protocol 16 → 17". It pointed at 116 issue-tracker numbers (91 distinct records, four of them in sibling repositories). Every number is gone. Where the sentence already said what was decided, the number was dropped. Where the number stood in for the decision, the decision is now stated. For example:

- The app-area paragraph says the fail-open area gates' caveat "was CLOSED by a server-side fix inside this same 17.0.0 window". The fix is described in the same sentence: `filterAppForUser` now runs the same `filterNav` over every `areas[].navigation`.
- The datasource paragraphs name the change that validates `datasource.config` against the declared driver's own config contract, and the follow-up that retired the factory's legacy key aliases.
- The aggregation paragraph names the freeze it relied on as the maintainer's freeze on the in-memory and MongoDB drivers, lifted 2026-08-11. It names the divergence class as the one closed when every SQL face got one aggregate spelling and one refusal.
- The `view.exportOptions` paragraph says PDF export was declined platform-side as not planned.

Text only. No step, conversion, semantic entry, retired key or retired def changes: no id, order, schema or behaviour. The generated upgrade guide was regenerated from the new text. A tool that matched this rationale by its old text, for example by a tracker-number substring, needs the new spelling.
