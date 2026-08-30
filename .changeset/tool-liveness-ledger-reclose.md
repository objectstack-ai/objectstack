---
'@objectstack/spec': patch
---

liveness ledger: re-close `tool.json` against the real cloud runtime, and repair a `_note` that was false three ways (#13042)

All six entries cited `packages/services/service-ai/…` — a path that exists in
**neither** repo. The framework has no service-ai tree at all (`git ls-files`
matches 0 paths containing it; `packages/services/` holds 16 members, none of
them service-ai), and the cloud repo's real layout is `packages/service-ai/…`
and `packages/service-ai-studio/…`. Six pointers into thin air, green for as
long as they existed because `scripts/liveness/evidence.mts` hardcodes exactly
the wrong spelling in `FOREIGN_PATH_PREFIXES` and so never resolved them.

Re-closed against cloud `origin/main@15f55df` and objectui `origin/main@26896c6`
— the first pass run from a container with both checkouts in reach, which is the
executor constraint that parked this card. All six entries are now dated.

- `name`, `description` — confirmed `live`, and both now carry **framework-local
  anchored** evidence (`packages/mcp/…#registerToolFromDefinition`, the MCP
  bridge that reads each `AIToolDefinition`) beside the cloud citation. CI can
  falsify them from this checkout for the first time; the old note's claim that
  "the OPEN framework edition does not consume them" was false for these two.
- `parameters` — confirmed `live` on the cloud LLM path. Deliberately *not*
  co-cited to the MCP bridge: that bridge never forwards the key, while its own
  docblock says it does (filed as #13271).
- `label` — confirmed `live` and given its **first evidence pointer ever**; it
  had carried a bare `live` with no `evidence` field since seeding, the one row
  the #13003 census could not even call stale.
- `outputSchema` — stays `experimental`, with the negative half now measured
  rather than asserted: the key occurs on exactly four non-test lines in the
  whole cloud repo, and none of them validates anything.
- `objectName` — stays `live`, but **on a completely different basis**, and the
  row now says so. Its stated basis is falsified: both cited sites read
  `action.objectName` (`action.json` carries the identical citation verbatim),
  and the same-named `AIToolDefinition.objectName` is written and read by
  nothing, so the key gates, binds and routes nothing. The consumer that does
  exist is objectui's registered metadata-admin preview, which reads it off the
  persisted record and renders it as the header's object pill — the #7131
  display-key rule, and pinned in `ToolPreview.test.tsx` over a comment reading
  "`objectName` is NOT residue". So: `live` as a **display** key, never as a
  binding, and explicitly not an ADR-0049 retirement candidate — retiring it
  would delete a key the renderer deliberately renders and tests.

The `_note`'s fourth false claim is corrected in the same pass: "tool metadata
is WRITE-ONLY … not metadata read-back" is simply untrue, and it is the reason
nobody had looked at the renderer. `ToolPreview` reads **all six** props off the
stored record. The type therefore has two live bases — the `AIToolDefinition`
surface (behavioural) and the metadata read-back (display) — and each row now
names which one carries it.

Data-only: no schema, no runtime, no authoring surface changes, and no verdict
moved, so `state-counts.md` is untouched and still current. `liveness/` is in
this package's `files` array, so these ledgers ship in the npm tarball and this
is published data.
