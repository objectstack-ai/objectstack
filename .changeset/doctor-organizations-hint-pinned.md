---
"@objectstack/cli": patch
---

chore(cli): pin the multi-org runtime name `os doctor` prints, so a roster rename cannot drift it silently (#12464)

`doctor.ts`'s `TENANCY_POSTURE_FIX_HINTS` repeated `serve`'s `isolated` posture
sentence verbatim, carrying its own bare `@objectstack/organizations` literal
under no check at all. PR #12463 single-sourced and pinned every operator-facing
occurrence in `serve.ts`; this copy was outside that card's file surface and was
correctly left alone. The defect it left behind is the same class: a roster-key
rename would leave `os doctor` naming a package that boot no longer resolves,
**with every gate green** — the roster pin only ever sees the declaration, and
nothing read this hint table's text.

The `isolated` hint now interpolates a module-level `ORGANIZATIONS_RUNTIME_PKG`
in `doctor.ts`, and a new sibling test pins it on two legs: the **rendered**
bullet compared whitespace-included against text built from that declaration
(the #12463 shape — asserting what the operator sees, never that a constant
appears in source), and a **roster** leg asserting that declaration IS a key of
the spec-owned `PLATFORM_PLUGIN_WIRED_RUNTIMES`. The roster leg is the load-bearing
one: without it the hint and its expectation move together under a rename and
nothing goes red.

**This deliberately does not single-source the spelling, and the constant's
docblock says so at the site.** The literal is still declared three times (the
roster key, `Serve.ORGANIZATIONS_RUNTIME_PKG`, and now this const). The roster
cannot supply the name — it is keyed BY package name, its row type carries no
`package` field by design, and its own header records that it is "not a
resolution registry" — and importing `serve`'s export into a diagnostic command
would be a worse coupling than the duplication it removes. What changes is that
this copy can no longer drift in silence. The duplication ends properly when a
shared tenancy-hint table lands (tracked at #12492); the docblock carries that
deletion condition.

**No behaviour change.** The declared value is byte-identical to the literal it
replaces and the rendered bullet is unchanged.
