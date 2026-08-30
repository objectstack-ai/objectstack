---
"@objectstack/cli": minor
---

feat(cli): `os meta delete` can pin its reset and can discard only the pending draft (#13024)

`os meta delete <type> <name>` was the only in-repo caller of the SDK reset and
called it with two arguments, so **every** CLI reset was the unpinned, full one:

- **unpinned** — a concurrent edit was silently destroyed instead of answering
  `409 metadata_conflict`, on the one verb whose whole job is destroying a
  customization overlay row (ADR-0008; the reset door reads `If-Match` and
  threads it as `parentVersion`);
- **full** — it dropped the published overlay as well as any pending draft, so
  an operator who wanted to throw away only an unpublished draft had to take the
  more destructive path.

Both carriers already existed one layer down — `DeleteMetaItemOptions`
(`ifMatch`, `state`) landed on both `@objectstack/client` `deleteItem`
declarations in #12181 — and only the CLI surface was missing.

Two new flags, additive; a run with neither is byte-identical to before (no
query string, no extra header):

- `--if-match <version>` — echo the `version` a previous save or publish
  resolved and a stale reset is refused with `409 metadata_conflict` instead of
  destroying the other author's edit. Unpinned stays the default, and stays
  last-write-wins.
- `--draft` — discard only the pending draft overlay, leaving the published
  overlay serving. Without it the reset is the full one, unchanged.

An **empty** `--if-match` is refused before anything reaches the server, rather
than being forwarded as "no pin". `os meta delete view v --if-match "$VERSION"`
with `VERSION` unset expands to an empty argument, and silently running the
unpinned reset there is exactly the destruction the flag exists to prevent. The
refusal names the remedy, and reaches both the human output and the
`--format json` error envelope.

In human (`table`) mode a `--draft` run now prints `Pending draft discarded:
<type>/<name>` instead of `Metadata deleted: <type>/<name>`, which would be a
false report of what happened on the narrower verb. The `json`/`yaml` payload
keys are unchanged (`success`, `type`, `name`, `deleted`).

⛔ Not added, deliberately: `?dropStorage`, the door's third carrier. #12181
withheld it because it is the one that ADDS destructive reach (it drops the
object's physical table), and no caller has been measured needing it. Publishing
it from the CLI would reverse that ruling from the layer above.
