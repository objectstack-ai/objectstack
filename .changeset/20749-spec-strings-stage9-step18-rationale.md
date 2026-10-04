---
'@objectstack/spec': patch
---

The protocol 17 → 18 upgrade rationale no longer cites tracker numbers; each cited decision is stated in words

Clause-②: no

`MIGRATIONS_BY_MAJOR[18].rationale` in `@objectstack/spec` is the prose an author reads when upgrading metadata to protocol 18. `os migrate meta` prints it for that hop today, because its chain runs to the highest registered major, and `docs/protocol-upgrade-guide.md` will reproduce it once protocol 18 is cut. It is built from one fragment per retirement, and 49 of those fragments pointed at 88 tracker numbers: issue numbers in this repository and in objectui, and four decision-batch numbers. Every number is gone. Where the sentence already said what was decided, the number was dropped. Where the number stood in for the decision, the decision is now stated. For example:

- The export-wildcard paragraph says the admin sets' wildcard was the export-axis twin of "the earlier removal of `member_default`'s CRUD wildcard".
- The `allowRestore` / `allowPurge` paragraph says the ruling "chose retiring the two bits over gating operations that do not exist", and that `allowTransfer` stays because the server guards who may rewrite a record's owner.
- The `reference_to` paragraph says the conversion is the server half of the ruling that the server normalizes the protocol and the renderer only executes it.
- The translation paragraphs give each ruling its date and its content: settings copy belongs to the platform, and one app metadata type has two authoring doors and one accepted shape.

Text only. No fragment id or order, conversion, semantic entry, retired key or retired def changes: no schema or behaviour. No generated artefact prints step 18 yet, so none was regenerated. A tool that matched this rationale by its old text, for example by a tracker-number substring, needs the new spelling.
