---
"@objectstack/core": patch
---

fix(core): only a backend fault populates `resolveLocalizationContext`'s failure memo (#11877)

`resolveLocalizationContext` memoizes an outcome for 30s whenever the read
"failed" (#10221 — so a repeatedly-failing `sys_setting` query does not re-run,
and the driver does not re-log it, on every request). The write condition was
wider than the cache's own docblock: six legs set the flag and only **one** of
them is the backend fault the docblock describes (the direct `ql.find` throw).
The other five are the **settings service refusing** — a thrown `getMany`, each
of the three older per-key `get`s, and the whole-block "service unavailable"
handler.

Those five legs are reachable inside the settings engine's **bind window**
(`SettingsService.getMany` refuses all-or-nothing for a `localization`
namespace whose manifest is not yet registered), so:

- A caller that deliberately re-reads **after** the bind — the #11580 stdio
  repair re-resolves at `kernel:bootstrapped` for exactly this reason — was
  answered from the memo taken **inside** the window for up to 30s. The
  correction silently did not happen, with nothing in the output saying so.
- A settings refusal standing alongside a perfectly **successful** direct read
  memoized that successful value — the staleness the docblock forbids outright
  and that `analytics-timezone.dogfood.test.ts` (#1982/#2018) exists to catch.

The memo is now written only for the direct-read fault. **#10221's protection
is unchanged for the legs it was built for**: its environment (table not
migrated yet) still memoizes, because the direct read throws there whether or
not a settings refusal stands in front of it — pinned in both directions. And
nothing is lost on the narrowed legs: those refusals throw out of an in-memory
registry check *before* any query and *before* any log line, so memoizing them
suppressed neither.

No signature, export or accepted-input change — the flag is internal to the
module.
