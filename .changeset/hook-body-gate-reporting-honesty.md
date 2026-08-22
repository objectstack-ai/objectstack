---
"@objectstack/cli": patch
---

Make the hook-body build gates report only what they establish (#10678). Three
defects, one shape — a gate reporting something it never established. The
enforcement net was never the gap and is unchanged: no forbidden body ever
shipped as `body.source`, and every forbidden or free-identifier hook is still
refused under `--strict-body`, at the same exit codes as before.

**The default build no longer warn-and-bundles in silence.** A hook body
containing a forbidden pattern made `os build` exit 0 with no output at all: the
extraction failure was recorded in `bodyExtractionWarnings` and then printed
nowhere, so the only way to learn a handler had *not* become a metadata body was
to diff the artifact. The recorded warnings now reach a human — on stdout,
naming the hook and the pattern, with a pointer at `--strict-body` — and in
`--json` under a new `bodyExtractionWarnings` key. That key is separate from
`warnings` on purpose: `warnings` carries author-time rule advisories in the
shape `os validate --json` also reports, and these are a different record
(`{origin, reason}`). It is an empty array on a clean build, so a CI consumer can
read it unconditionally.

The build still exits 0 in this case. Making a forbidden pattern fatal by default
would change what `os build` accepts and is not part of this change.

**The `require()` refusal reason now fires on the real authoring path.** A
TypeScript config is loaded through `bundle-require` → esbuild, whose ESM interop
shim rewrites `require('node:os')` to `__require("node:os")` before `String(fn)`
runs — so the `require()`-specific reason could never match, and the refusal
arrived instead as the generic free-identifier message naming `__require`, an
identifier the author never typed. Both spellings now carry the one reason, which
also explains the rewrite. Accept behaviour is unchanged: the body was already
refused, already bundled, at the same exit code; only the wording moved.

**The `// @capabilities` directive is documented at its real reach.** It is read
off `String(fn)`, and esbuild strips `//` line comments before the handler is ever
a runtime function — so through `os build` it reaches the extractor from no
ordinary authoring shape. Measured on all four: `objectstack.config.ts`, `.js`,
`.mjs`, and a handler imported from a local `./handlers.js` all silently drop it
and ship the inferred capabilities alone. `hook-bodies.mdx` and the extractor
header now say so, and point at `body.capabilities` — data rather than a comment —
as the escape hatch that does survive. Whether the directive should gain a real
authorable surface or be retired is left open.

The extractor header claimed a forbidden pattern "makes the build **fail** …
no silent fallback"; docs described warn-and-bundle. The code agreed with the
docs, so the header was the outlier and has been rewritten to describe both
outcomes.

A new `os build`-level test (`hook-body-build-reach.e2e.test.ts`) spawns the real
CLI and pins all three behaviours against the artifact and the shell's exit code.
The existing extractor unit tests could not have caught any of this: they feed raw
JS function literals, which keep their comments and their `require(` spelling
because nothing transformed them.
