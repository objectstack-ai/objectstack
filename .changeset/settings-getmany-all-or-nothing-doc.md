---
"@objectstack/service-settings": patch
---

docs(service-settings): state `getMany`'s all-or-nothing key validation on the declaration that owns it (#11680)

Documentation and a pin. **No behaviour change** — the accept set and every
resolved value are byte-identical.

`SettingsService.getMany` validates **every** requested key against the
namespace manifest before it reads a single env override and before it loads a
single row, so one undeclared key rejects the whole call with
`UnknownKeyError` (`code: 'SETTINGS_UNKNOWN_KEY'`) and the caller receives
nothing — not the subset it was entitled to. N per-key `get()` calls behave
differently on exactly that input: each declared key still answers, and only
the undeclared one throws.

The doc comment was otherwise detailed — it explained the grouped row load and
the env-override ordering, and claimed row-for-row equivalence with per-key
`get` "BY CONSTRUCTION" — but never drew this line. That equivalence claim
holds for every key that *resolves* and not for the refusal, so a batched
consumer had to rediscover the rule from a test. `resolveLocalizationContext`
was the first to inherit it and had to record the consequence locally: a host
registering a **partial** `localization` manifest loses all its keys at once
and drops to a shorter cascade, where the per-key path would still have
resolved the declared ones.

`getMany`'s doc comment now states the rule, its blast radius, why validating
ahead of the grouped walk makes the refusal independent of key order and scope
grouping, and what a caller on a partial manifest should expect.

The pre-existing pin asserted only `rejects.toThrow(/nope/)` — green whatever
the blast radius is. A sibling pin now asserts the property instead: the error
envelope (`code: 'SETTINGS_UNKNOWN_KEY'`), that **zero** rows were loaded
(the refusal is up-front, with the undeclared key last in the request), and
the contrast that per-key `get()` still answers each declared key.
