---
"create-objectstack": patch
---

Fix `create-objectstack`'s closing "Next steps" and install-failure remedy
hardcoding `npm` regardless of which package manager the run actually used
(#10322). `detectPackageManager()` already prefers `pnpm` and falls back to
`npm` only when `pnpm` is unreachable — confirmed still true at HEAD, and
confirmed empirically: a real run with `pnpm` on `PATH` installs with `pnpm`
(`pnpm-lock.yaml`, "Done in … using pnpm vX") and then told the newcomer to
run `npm run dev` / `npm run validate` next, a package manager the run never
touched. The detected package manager is now read once, up front, and reused
consistently for the install command, the install-failure remedy, and every
line of "Next steps" — so the printed guidance always names the tool the run
actually used, in both the `pnpm` and the `npm`-fallback case.

Also names `validate` — the step the generated `AGENTS.md` calls
unskippable — in the "Getting started" section of the generated `blank`
template's README, not only in its later "Verify your changes" section, so a
newcomer reading top-to-bottom sees it at first touch.

No install behaviour changes: the scaffolder still installs by default and
still supports `--skip-install`; this is a messaging-only fix.
