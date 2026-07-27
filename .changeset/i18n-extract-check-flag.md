---
"@objectstack/cli": minor
---

feat(cli): `os i18n extract --check` — fail instead of writing when translation bundles have drifted

Generated translation bundles had no freshness gate, so they rotted silently
until someone happened to re-run the extractor by hand. #3670 found three
distinct drifts sitting in the committed bundles at once: translations left
behind for schema keys that had been REMOVED, keys the schema had GAINED with
no entry at all, and an object whose labels were committed as empty strings
(which renders blank rather than falling back to anything readable).

`--check` writes nothing and exits non-zero when a fresh extract differs from
what is committed in `--out`, listing each stale or missing file and printing
the exact regenerate command. It runs the identical render path as a real
extract — both branches iterate the same rendered set — so the check can never
disagree with what writing would produce.

It runs in **merge mode** like any other extract, so it never asks anyone to
re-translate: an up-to-date bundle re-extracts byte-identically. Requires
`--out`, since there is nothing to compare against without it.

In this repo it is wired up as `pnpm check:i18n` and gated in CI, but the flag
is on the CLI, so any consumer shipping generated bundles can gate them the
same way.
