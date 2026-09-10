---
"@objectstack/cli": minor
---

fix(cli): `os i18n check` counts the coverage an app actually owns, so `--strict` / `--threshold` can gate an app package (#16681)

## What was wrong

`collectExpectedEntries` walks the Studio metadata-form registries
unconditionally — identically for every config, an empty one included — so
every stack's expected set carries ~773 `metadataForms.*` keys that
`@objectstack/platform-objects` translates and the runtime already serves.

Two of the three commands that see that family already knew it is not the
author's. `os lint` hides it and says so ("platform built-ins: 773 i18n
issue(s) hidden — rerun with `--include-platform`"); `os i18n extract` has
`--no-metadata-forms`. `os i18n check` is the one command that publishes a
**percentage**, and it carried the baseline in its denominator:

```
Coverage by locale
  en       ████████████████████████ 100.0%  (1265/1265, missing 0)
  zh-CN    █████████░░░░░░░░░░░░░░░  38.9%  (492/1265, missing 773)
```

That is an application with every key it owns translated. `--strict` and
`--threshold` — the two flags whose entire purpose is CI gating — therefore
could not gate an app package at all, and the only way to move the number was
to ship a copy of the platform's bundle, which would *override* the platform's
own and go stale at the next upgrade. The workaround was worse than the defect.

## What it does now

**Ownership is observed, not assumed.** The baseline counts toward coverage
when the stack under examination ships those translations itself, and does not
when it does not — read from the config's own `translations` bundles, requiring
a non-empty string leaf so an `--fill=empty` scaffold is not mistaken for a
claim of ownership. An app gets a number about its own surface with no flag;
`platform-objects`, which does ship the family, stays gated on it with no flag
either. An unconditional exclusion would have turned the app side green by
deleting the platform's own gate, and is what the negative-control tests forbid.

**The flag is `os lint`'s, spelling and all.** `--include-platform` forces the
baseline in; `--no-include-platform` forces it out, for a package that ships a
partial baseline and does not intend to own the rest. Absent, the decision is
the observed one — three states, not two.

**Both output faces carry the decision.** `--json` gains
`platformMetadataForms: { mode, excludedKeys }`, and the console prints
`platform built-ins: N key(s) not counted — rerun with --include-platform to
gate them here` under the coverage table, rendered from those same two numbers.

`os lint` is unchanged. The shared `computeI18nCoverage` seam still counts the
baseline by default, because lint folds it away one seam later and counts what
it folded for its own hint line.

## Compatibility

Additive on the command surface; an invocation that was refused is now
accepted, and no flag is removed or renamed. The behaviour that changes is the
**default coverage number for a stack that ships no `metadataForms` bundle** —
it stops reporting a debt that stack must not pay. A run that wants the old
numbers back asks for them with `--include-platform`, on the same argv.
