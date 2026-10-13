---
'@objectstack/metadata-core': minor
'@objectstack/metadata': patch
---

fix(metadata-core): an artifact declaring `engines.protocol: '^18'` that was built during the v18 prerelease boots on a later runtime that retired one of its shapes — the artifact door replays every retired conversion of protocol 18's step for a floor of `18.0.0`

Clause-②: yes

**What an operator saw.** A compiled artifact (`os build` → `dist/objectstack.json`) that declares `engines.protocol: '^18'` and was built before a protocol-18 retirement landed carries the retired shape, for example a defaulted key that every earlier parse emitted. Booted on a runtime that enforces the retirement, the metadata plugin's startup refused it at the strict parse and the boot rolled back. The artifact door compared the floor `18.0.0` with each retirement's `retiredAfter` stamp, and every retirement that lands during the v18 prerelease is stamped with the last 17.x release, below that floor, so nothing was replayed.

**What an operator sees now.** The same artifact boots. One warning per conversion names it and its site count: `[MetadataPlugin] artifact 'LABEL' declares the first release of protocol 18 (authored engines.protocol floor 18.0.0), which a build from any 18.0.0 prerelease declares too, so it may predate retirements in the conversion step into protocol 18 that this runtime enforces (runtime spec VERSION) — converted N site(s) forward via ADR-0087 conversion 'ID' …`. The artifact file itself is unchanged, so it converts again on every boot until it is rebuilt with `os build`. An artifact built after the retirement boots exactly as before: the replay finds nothing to convert, and nothing is logged.

- **`@objectstack/metadata-core`.** `applyArtifactForwardConversions` opens its window on a third condition. A declared floor of `M.0.0` at or above the runtime label replays every retired entry whose `toMajor` is `M`, except the default flips the door already refuses. An artifact cannot say which of those entries it predates: it carries no field naming the spec or CLI that built it. Each entry rewrites only its own old shape, so the replay changes nothing in an artifact that lacks that shape. `ArtifactForwardConversionVerdict` gains `'converted-major-step'`, so a consumer that switches exhaustively over the verdict adds that arm. `replayedRetirements` still lists only the entries the per-entry rule opened. The rule holds for every 18.0.0 prerelease label and at 18.0.0 itself. From 18.0.1 on, the label half replays the whole chain for such an artifact, as before.
- **`@objectstack/metadata`.** The artifact door places the new verdict on the open side of its window table and gives it its own clause, so the summary never claims that a `^18` artifact "predates" a runtime labelled below it. The bare-root form-predicate notice uses the same window.

**Unchanged.** The protocol handshake still refuses a `^17` artifact on a protocol-18 runtime and prescribes `objectstack migrate meta --from 17`. A floor above `M.0.0` (such as `^18.0.1`) and a 17.x floor keep their previous verdicts.
