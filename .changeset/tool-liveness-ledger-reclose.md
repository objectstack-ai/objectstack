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

Re-closed against cloud `origin/main@15f55df` — the first pass run from a
container with a cloud checkout in reach, which is the executor constraint that
parked this card.

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
- `objectName` — **left `live` and deliberately UNDATED.** The cloud walk
  falsified its stated basis (both cited sites read `action.objectName`, and
  `action.json` carries the identical citation verbatim; the same-named
  `AIToolDefinition.objectName` is written and read by nothing). It is not
  re-graded here because the only remaining candidate reader is an objectui
  read-back, and no objectui checkout was reachable — publishing `dead` on that
  search is the `app.homePageId` failure shape. Staying undated keeps it on the
  `--stale-verification` worklist, which is the honest place for a claim that
  could not be closed.

Data-only: no schema, no runtime, no authoring surface changes, and no verdict
moved, so `state-counts.md` is untouched and still current. `liveness/` is in
this package's `files` array, so these ledgers ship in the npm tarball and this
is published data.
