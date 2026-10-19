---
'@objectstack/spec': patch
---

fix(spec): a page that declares `print` is no longer warned that nothing applies it, and the flow terminal-toast translations read `live` (#23710)

Clause-②: no

**What was wrong.** The console now prints a page that declares `print`: its `PageRenderer` mounts a print stylesheet built from every key of the declaration (paper size and orientation, the four margins, the running header and footer, page numbers, and the two page-break hints). But the liveness ledger shipped with `@objectstack/spec` still graded `page.print` `planned` with an author warning, so `os validate` / `os build` / `os lint` told every author of a print page that printing it prints the screen layout. The `print` describes said the same ("until it ships, nothing applies it").

**What changes.**

- `liveness/page.json`: `print`, its eight keys and the four `margins` sides read `live`, citing the console reader at the `.objectui-sha` pin. The container's `authorWarn` / `authorHint` are dropped, so `lintLivenessProperties` no longer emits `liveness-planned-property` for a page that declares `print`.
- `liveness/translation.json`: `flows.successMessage` and `flows.errorMessage` read `live`. The console's flow runner shows the translated terminal toast through `translateFlow` and falls back to the flow's own text when the bundle has none.
- `PagePrintSchema` and `PageSchema.print`: the describes name the console's browser print rendering as the consumer that applies each key. The server-side PDF renderer is still to come.

Unchanged: what a `print` declaration accepts and refuses, and every other ledger row.
