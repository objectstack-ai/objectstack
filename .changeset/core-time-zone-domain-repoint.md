---
'@objectstack/core': patch
---

refactor(core): the authz context's time-zone probe is now the shared value-domain predicate, not a third copy of it

`resolve-authz-context.ts` carried a module-private `isValidTimeZone` — the
`Intl.DateTimeFormat` probe, re-stated. It was the third copy of one
definition, alongside `@objectstack/spec/shared`'s `isValueDomainMember` and
`service-settings`' own re-statement. `coerceTimeZone` now calls
`isValueDomainMember('iana_time_zone', …)` and the copy is gone.

**No behavioural change, measured rather than asserted.** The two predicates
were run over a shared 4,058-input corpus — the zones
`Intl.supportedValuesOf('timeZone')` omits (`UTC`, `Asia/Kolkata`,
`Europe/Kyiv`, `Asia/Ho_Chi_Minh`, `US/Eastern`, `GMT`), every member of that
enumeration plus its case- and space-padded variants, refusals, `Etc/` and
offset spellings, legacy aliases, and fuzz — with **zero disagreements**, and
the same zero at the `coerceTimeZone` level. The call site's own
pre-processing (trim, stringify a non-string, refuse blank) is unchanged.

What this buys is drift resistance, not a fix: core's time-zone acceptance now
sits under the shared pins, so a future "modernisation" to
`Intl.supportedValuesOf('timeZone')` — which would silently narrow what the
authz context accepts, since that enumeration omits this platform's own
default `UTC` — turns a test red instead of shipping.
