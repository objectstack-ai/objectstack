---
"@objectstack/spec": patch
---

`i18n.zod.ts` stops asserting a stale size for the inline-locale-map population.

Two docblocks in this file each stated that the repo authors 31 inline locale maps — the
`INLINE_LOCALE_KEY` rationale ("Every inline map authored in this repo (31 of them, across
three platform pages) uses `en` / `zh-CN` / `ja-JP` / `es-ES`, so the constraint costs no real
authoring surface") and the `I18nLabelSchema` form-2 note ("Three published platform pages
author 31 of these"). The measured population is 45: 33 in `sys-user.page.ts`, 6 in
`sys-organization.page.ts`, 6 in `sys-position.page.ts`.

The number is **dropped** at both sites rather than corrected to 45. Neither sentence's
argument needs a magnitude. The first turns on the universal — *every* authored map uses those
four tags — so the accept set is what makes the constraint free, not the size of the set. The
second turns on the map being authored on published platform pages *and* resolved by
`pickLocalized`; one authored-and-resolved map already refutes "a convention the runtime
ignores", so the count was never load-bearing there either. Writing 45 would buy one release of
accuracy in prose that is cited as evidence for a schema constraint, and the figure has already
drifted once with nothing noticing; deriving it would mean a permanent gate whose only job is
keeping a number in a comment true.

The measured half survives untouched at both sites: three platform pages author these maps, and
that is still exactly three. No schema arm, bound, default, `.describe()` string or export
changes; nothing an author can write is affected.
