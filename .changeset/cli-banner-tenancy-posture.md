---
"@objectstack/cli": patch
---

fix(cli): the boot banner's `Tenancy:` row now reports the resolved posture, not the superseded boolean (#4801)

`printServerReady` printed `Tenancy: multi-tenant | single-tenant` from a boolean
`multiTenant` that `serve` filled with `resolveMultiOrgEnabled()` — i.e. from
`OS_MULTI_ORG_ENABLED`. [ADR-0105 D1] replaced that knob with
`OS_TENANCY_POSTURE`, keeping the boolean only as the fallback
`resolveTenancyPosture()` consults when the posture is unset, and **the runtime
wiring in `serve` already keys off the posture**. So the banner and the server it
describes read two different sources for one fact, and they drifted exactly where
it hurts: booting with `OS_TENANCY_POSTURE=isolated` and `OS_MULTI_ORG_ENABLED`
unset printed

```
  Tenancy: single-tenant
  Plugins: 40 loaded
           …, Organizations, …
```

— the banner claiming single-org one line above the plugin table that proves the
organization wall is up (observed on a real boot in cloud#1020, where the lie was
only caught by hand-comparing the plugin list).

This is not cosmetic. It is the "declared ≠ enforced" class (ADR-0049) landing on
the **diagnostic** surface, which is the worst place for it: a banner that can be
wrong costs every later investigation an extra lap proving whether it is.

**What changes for users.** The row now prints the posture verbatim — `Tenancy:
single`, `Tenancy: group`, `Tenancy: isolated` — sourced from the same
`resolveTenancyPosture()` call the runtime wiring uses. The old `multi-tenant` /
`single-tenant` vocabulary is gone. That vocabulary was itself part of the defect:
tenancy has been a three-valued spectrum since ADR-0105, and a boolean has no
spelling for `group` at all, so a `group` deployment could only ever be
misreported.

**The internal `multiTenant` option is removed, not deprecated.** With the posture
authoritative, a retained boolean could only ever be a field the printer ignores —
and a field that exists but cannot be believed is precisely how this bug was
authored in the first place. `ServerReadyOptions.tenancyPosture` is typed as
`TenancyPosture`, so re-wiring the banner to the legacy boolean now fails to
compile (`resolveMultiOrgEnabled()` returns `boolean`) instead of producing a
plausible-looking wrong line. The interface is package-internal — `format.ts` is
not re-exported from `@objectstack/cli`'s entry point — so no consumer code needs
a change.

Regression-pinned in `packages/cli/src/utils/format.tenancy.test.ts`, which asserts
the printed token **is** `resolveTenancyPosture()`'s answer across the cases that
made the old code wrong: posture set with the boolean unset, posture unset with the
boolean true, both set and contradicting (either direction), the legacy `multi`
spelling, and `group`.
