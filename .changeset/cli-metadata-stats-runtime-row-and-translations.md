---
"@objectstack/cli": patch
---

**Fix:** the `Runtime:` row of the `os validate` / `os info` / `os compile` summary is no longer dropped on a stack with no plugins, and `MetadataStats` no longer counts a metric nothing prints (#11172).

Two separate holes in one function, `printMetadataStats` in `packages/cli/src/utils/format.ts`. Both were measured against the real CLI (`bin/run-dev.js validate`, `NO_COLOR=1`) on a stack declaring nothing.

**1. `Runtime:` vanished at zero.** The row was rendered *outside* the `sections` loop, as a standalone `if (stats.plugins > 0 || stats.devPlugins > 0)` after the loop closed, so the whole summary was:

```
  Data: 0 Objects
  UI: 0 Apps
  Logic: 0 Flows
  Security: 0 Positions  0 Permissions
```

with no `Runtime:` line at all. That is the same "reads as never asked, not as zero" shape #10504 and #10952 removed from the four sections — a stack that declares no plugins is indistinguishable from a summary that simply does not report on the runtime. It now prints:

```
  Data: 0 Objects
  UI: 0 Apps
  Logic: 0 Flows
  Security: 0 Positions  0 Permissions
  Runtime: 0 plugins
```

`Runtime:` was **folded into the `sections` array** rather than fixed where it stood. Being outside the loop was not incidental to the defect: it is why #10952's `zeroFallback` mechanism was structurally unable to reach this row, and a zero case hand-rolled beside the loop would have been a second, un-enforced copy of the same invariant — while `zeroFallback` is a *required* field on the array's element type precisely so the next row cannot be added without naming what it prints at zero. The per-item `> 0` filter this row already applied is the same filter the loop applies, so the only thing that had to be carried across was its fragment style, and it is carried exactly: the shipped non-zero rendering stays `Runtime: 2 plugins, 1 devPlugins` — comma-joined, fully dim, lowercase item names — rather than being restyled into the sections' `<count> <Item>` two-space shape. The ruling was about the row's presence at zero, not its typography.

`plugins` is the row's zero signal: `devPlugins` is a dev-only overlay on it, so `Runtime: 0 devPlugins` would have reported the narrower fact and stayed silent about the broader one. A row with one non-zero peer still reports only that peer (`Runtime: 4 devPlugins`), exactly as `Security:` behaves.

**2. `translations` was counted on every run and read by nothing.** `MetadataStats` declared `translations: number` and `collectMetadataStats` populated it with `count(config.translations)`, but no render path ever read it — a stack with 40 translation bundles reported them nowhere in the summary, at *every* value rather than only at zero. The field is removed implementation-first (zero readers); giving it a rendered home, in `UI:` or a new `i18n:` row, was considered and explicitly not taken.

The invariant that replaces it is enforced from both ends: TypeScript already requires `collectMetadataStats` to populate every field `MetadataStats` declares, and a new pin requires every field it collects to reach the rendered output. Declared ⇒ collected ⇒ rendered — a metric counted on every `os validate` and shown nowhere cannot satisfy the chain, whatever it is called, so the pin fails for the next unread metric as well as for this one.

**One externally visible consequence beyond the summary text.** All three commands spread the whole `stats` struct into their `--json` payload, so `os validate --json`, `os info --json` and `os compile --json` no longer carry a `stats.translations` key. That field was undocumented (the CLI docs describe `--json` for these commands but declare no payload shape for `stats`), carried no schema, and has no reader anywhere in the repo — a repo-wide search for `stats.translations` returns zero consumers. The other 18 keys are unchanged.
