---
'@objectstack/spec': patch
---

A browser bundle that imports from `@objectstack/spec/shared` or the package root no longer keeps the ADR-0087 conversion table unless it uses it

Clause-②: no

Each published entry is one flat file, so a consumer's bundler keeps every top-level call it cannot prove pure, together with everything that call references. Two such calls built the conversion table when the module loaded: the major-18 list's `inApplicationOrder(...)` and the flattening into `ALL_CONVERSIONS`. So every bundle of an entry that reaches the table kept all of it: every conversion, plus the view, field, page-component, dashboard, chart and report schemas the conversions read. `./shared` reaches the table only through `normalizeStackInput`, so a bundle that imported an expression schema from it carried the table too, and 17.7.0's new conversions made that copy larger. Both calls now carry a `@__PURE__` annotation, so a bundle keeps the table only when something it keeps reads it, for example `defineStack`, `normalizeStackInput` or `applyConversions`.

Measured on objectui's console (objectui `c0862c1c`), against the same build with this package's previous source: the first screen's eager closure is 226,238 bytes gzip smaller, all of it in the `vendor-objectstack` chunk. Every entry's export list, every declaration and every runtime value is unchanged. Only the bytes a bundler keeps change.
