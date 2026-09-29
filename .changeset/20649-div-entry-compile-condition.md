---
'@objectstack/spec': patch
---

fix(spec): the `ui-html-page-div-refused` migration entry states when `dev` and `start` compile (#20649)

Clause-②: no

The entry's `reason`, which `objectstack migrate meta` prints as its `why:`
line, said `dev` and `start` run `objectstack compile` first. They run it before
they boot only when the artifact is missing or `--compile` is passed, and `dev`'s
watch mode runs it when a watched file changes. The text now says so. No schema
accepts or refuses anything it did not before.
