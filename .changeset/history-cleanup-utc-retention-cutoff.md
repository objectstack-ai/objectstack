---
"@objectstack/metadata": patch
---

`HistoryCleanupManager` computes its retention cutoff on one calendar, not two.

Both call sites — the age-based delete in `runCleanup()` and the preview count in `getCleanupStats()` — built the cutoff with `cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays)` and then rendered it with `toISOString()`. `setDate`/`getDate` read and write the **local** calendar; `toISOString()` renders **UTC**. They now use `setUTCDate`/`getUTCDate`, so the arithmetic and the rendering agree.

`setDate` preserves wall-clock time, so shifting the local calendar back `n` days moves the *instant* by exactly `n × 24h` only while every local day in the window is 24 hours long. When the window straddles a DST transition it is 23 hours (spring-forward) or 25 (fall-back), and the cutoff instant that goes into the `recorded_at: { $lt: … }` **delete** filter is off by the size of that transition — one hour in most zones, thirty minutes on Lord Howe Island. History rows within that slip of the retention boundary were deleted early, or retained too long.

The exposure is not limited to the two transition days: the window only has to *straddle* a transition, so it grows with `maxAgeDays`. Measured over a 12-zone × 366-day × 48-half-hour sweep of 2026, in `America/New_York` the old spelling produced a wrong cutoff for 0.6% of instants at `maxAgeDays: 1`, 16.4% at 30, 49.7% at 90 and 69.4% at 180. In zones that do not observe DST (`UTC`, `Asia/Shanghai`, `Asia/Kolkata`, `Australia/Perth`) the rate is 0.0% at every `maxAgeDays` — which is why no test had ever gone red on this.

This does **not** make retention timezone-aware, and does not change what `maxAgeDays` means. The cutoff was already intended to be `now − maxAgeDays × 24h`; it is now that in every zone rather than only in zones without DST. Nothing else in either filter moved: the `organization_id` scoping, the ADR-0009 `executionPinned` exclusion and the `maxVersions` path are untouched.
