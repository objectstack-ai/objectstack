---
---

ci: ratchet the examples' untranslated declared labels so the #3370 gate can actually fail

Releases nothing — root scripts and CI config only.

#3370 taught `os lint` to gate the whole declared surface, but seeing a problem
and failing on it are different things. `os lint --i18n-strict` — the honest
"these locales must be complete" gate — reports 97 / 212 / 456 errors on
app-crm / app-todo / app-showcase today, because those examples declare
`i18n.supportedLocales` and then leave a few hundred declared strings
untranslated. Switching it on as-is would paint CI red on day one and get
switched back off, which is how a gate stops being a gate.

`scripts/check-i18n-coverage.mjs` freezes that debt in
`scripts/i18n-coverage-baseline.json` and fails the build when a count grows —
i.e. when someone declares a label and does not translate it for a locale the
example claims to support. It follows `scripts/check-role-word.mjs`: `--update`
ratchets, and an *improvement* also fails, so the baseline can only go down.
Counts ignore severity (that moves with `--i18n-strict`) and exclude the
platform metadata-form baseline (owned and translated by platform-objects), so
what is tracked is the example's own declared surface.

Verified the gate bites: adding one untranslated action to app-crm takes it
97 → 99 and exits 1.
