---
"@objectstack/cli": patch
---

`os generate <type> <name>` no longer exits 0 after writing TypeScript the compiler cannot parse.

The command ran no name validation of any kind — no `validateProjectName`, no sanitiser — so the name went into a binding position untouched. `os generate object foo.bar` reported success and left two broken files behind: `const foo.bar: Data.ServiceObject = {` in `src/objects/foo.bar.object.ts`, and a matching `export { default as foo.bar } from './foo.bar.object';` appended to the barrel `src/objects/index.ts`. The author learned about it at the next `tsc`, in a file the scaffolder had just told them it created.

Both emissions are now rendered once, at the single point where the derived identifier is finished, and handed to TypeScript's own parser before anything is written. If either does not parse, the command prints the compiler's own diagnostics for each affected file and exits 1 without touching the filesystem — including under `--dry-run`, where a preview of un-parseable output under exit 0 is the same defect in preview form. One check covers all 14 emission sites across all 7 generators (`object`, `view`, `action`, `flow`, `dashboard`, `app`, `skill`) plus the barrel, and a generator added later inherits it.

- **The criterion is parseability, not a charset.** Nothing is rewritten and no name that already produced parseable output is refused: the accepted set moves only by the names whose emission was already broken. Which names `os generate` should accept — and whether it should normalise the ones it does, the way `os create` derives its identifier — is a separate, open decision. Deriving a legal-looking identifier from a name that should have been refused is the worse of the two failures, so this refuses loudly rather than answering that question by widening tolerance.
- **Asking the compiler is what makes the check correct per emission position.** A rule about identifier characters, or about reserved words, gets this wrong in both directions: `os generate object class` is refused (`const class:` is not a declaration) while `os generate view class` is accepted (that generator emits `const classViews:`), and a name carrying a quote or a comment terminator breaks the emitted file without touching the identifier at all.
