---
"@objectstack/spec": patch
---

fix(spec): publish each skill reference's own module doc block, not the first doc block in the file

`build-skill-references.ts` derived every `_index.md` pointer description from
the first doc block anywhere in the source file. That is a rule about ORDERING,
not about descriptions: whichever declaration happened to sit nearest the top of
a `.zod.ts` donated its comment to a customer-facing page, and moving a helper
up a file silently rewrote published text.

This is the defect the docs-site generator fixed by converging on
`findModuleDocBlock()` — the block must start at column 0, precede the first
declaration, and document no symbol. The skill-references generator was never
converted, so the two generators disagreed about the same sources. It now
imports the same selector rather than restating the rule, and `skills/**` is
loaded whole into customer agent context windows, so it was paying the higher
price for the same defect.

Thirteen pointer rows across seven skills change. The live victim named on the
issue is `system/translation.zod.ts`, whose `objectstack-i18n` entry opened with
"Shared history sentence for every shape in this file." — the comment on a
private `TRANSLATION_HISTORY` string constant, meaningless to the reader and not
a description of the Translation protocol. Twelve rows in that class now fall
through to the existing `Exports: …` line, and one gains a real module
description (`shared/metadata-types.zod.ts`), which also brings it into
agreement with the docs page for the same file.

Falling back rather than refusing is deliberate: an export list states a true
fact about the file, where the wrong block asserted a false one about its
subject. Whether a `.zod.ts` on this surface should be required to carry a
module doc block at all is a separate authoring question, left open here.
