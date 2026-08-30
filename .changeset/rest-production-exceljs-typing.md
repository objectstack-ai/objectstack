---
"@objectstack/rest": patch
---

fix(rest): type the two production exceljs dynamic imports behind one named accessor

Both places `@objectstack/rest` production source reached exceljs bound the
module as `const ExcelJS: any`, so `parseXlsxToRows` (the whole .xlsx import
path) and `createXlsxStream` (the streaming .xlsx export path) built workbooks,
read worksheets, iterated rows and read cells through a value tsc knew nothing
about. A misspelled method, a wrong argument arity or a property exceljs
renamed was not a compile error — it surfaced, if at all, as a runtime fault in
a deployed import or export.

`src/xlsx-module.ts` is now the single binding site both paths share, and it
keeps the load lazy: everything in it is either a type (erased at emit) or
inside the async accessor, so a CSV or JSON import still never pays to load
exceljs.

**Typing-only — no runtime behaviour change, and no change to the published API
surface.** `parseXlsxToRows` keeps its exact signature
(`(buffer: Buffer | ArrayBuffer, mapping?, sheet?)`), the package's exports are
unchanged, and the accessor is internal. The interop expression is the one the
call sites already ran (awaited once rather than twice — the second
`await import('exceljs')` resolved from the module cache to the identical
record), and the non-array shape of `Row.values` iterates zero times before and
after. `@objectstack/rest`'s 160 test files / 2698 tests pass unchanged.

This is a `patch` rather than a `skip-changeset` because it was measured to
reach the published artifact: `loadExcelJs` greps 3 in `dist/index.js` and 3 in
`dist/index.cjs` (`asXlsxLoadInput` 2 and 2), against a positive control of
`RestServer` = 36.
