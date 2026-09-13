---
"@objectstack/cli": patch
---

`os info`'s **detail** reads now resolve a package-owned collection through the seam the package already has for it, so an ADR-0130 D4 / option-B project (every definition inside `packages[]`, none flattened up) stops contradicting itself.

Measured through the real binary on the card's own repro, before the change:

```
os info --json   exit 0   stats.objects = 1 · objects[] length = 0
os info          exit 0   Data: 1 Objects  2 Fields   (no `Objects:` section, no `Apps:` section)
```

`stats` had learned to resolve `packages[]`; the four reads beside it had not, so one `--json` payload asserted `stats.objects: 1` next to `objects: []` — and nothing in the payload distinguished *this project has no objects* from *this reader could not see them*. `--json` is the face a machine reads, so a consumer could not recover from it.

- **The four reads** — the `--json` `objects` array and the `Objects:` / `Agents:` / `Apps:` text sections in `commands/info.ts` — go through `resolveStackCollection` (`utils/stack-collections.ts`), the one place this package resolves a package-owned collection.
- **Strictly additive.** That seam answers the caller's original expression FIRST and consults `packages[]` only when the top level does not carry the key at all, so **every stack the platform emits today reports exactly what it reported before** — pinned by a control run whose definitions are the same literals, authored at the top level instead.
- **No new failure mode.** `collectMetadataStats` on the line above already resolves the same package list through the same seam, so a malformed `packages` has already answered its ADR-0112 `422` before these reads run.

⛔ **Not decided here:** whether an option-B project's detail listing should be this flat union or grouped per package. Each entry keeps the shape and the key set it has always had — no package attribution is added — so that published-output-shape question stays exactly as open as it was.
