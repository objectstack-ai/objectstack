---
---

ci(release): add the objectui pin-freshness gate (#3340 P0). `scripts/check-objectui-pin-fresh.mjs` fails when `.objectui-sha` is not objectui `main` (or a named `--ref`), naming the commits ahead and the `.changeset/*.md` files declared after the pin — the blind spot that dropped four frontend changes, two of them `minor` features, from the v16 release page. Wired as `Console Pin Freshness` in `.github/workflows/objectui-pin-freshness.yml`: it runs on every PR so the context can be required in branch protection, but blocks only on the Version Packages / release PR. Distinct from ci.yml's `Console Pin Gate` (#4290), which proves the pin still *builds* rather than that it is still *current*. Tooling and CI only; releases nothing.
