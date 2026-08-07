---
"@objectstack/spec": patch
---

fix(spec): a reference page's opening paragraph is the module's own doc block, never a symbol's (#5059)

`getFileDescription()` took the **first** doc block anywhere in a `*.zod.ts`
file, verbatim, and published it as the page's opening paragraph. That is not a
rule about descriptions — it is a rule about *ordering*: whichever declaration
happened to sit at the top of the file donated its comment to a public
document. Adding a helper above the first schema silently rewrote a published
page, and no gate could see it. `check:docs` compares the generated page against
the source and the page reproduced the wrong block faithfully, so there was no
drift to report; the trap was written down when the generator was built and
still landed on `main` twice.

The measured victim surface was **six pages**. The Translation protocol
reference opened with `Shared history sentence for every shape in this file
(#4001).` — this repo's internal tightening-campaign narrative — and the Mapping
page with its sibling. Four more had no history constant anywhere near them:
`api/contract` published the doc of `ApiErrorSchema.code` (a comment *nested
inside* an object literal), `api/realtime` published `Transport Protocol Enum`
on a page documenting fourteen schemas, and `api/protocol` / `kernel/plugin` the
same shape. Any future "move a helper to the top of the file" makes another.

The selection now follows **TSDoc's own rule, read back**: a doc block belongs
to the declaration it immediately precedes — which is exactly the text an editor
shows when you hover that symbol. So a module description must be a block that

- starts at column 0 (a block indented inside a declaration body documents a
  property, never a module),
- appears before the first declaration (imports and re-exports introduce no
  symbol of their own and do not close the header zone), and
- is not immediately followed by a declaration.

When no block qualifies the page prints no description at all — 宁可缺,不要错.
A confidently rendered internal note is a page that lies about its subject,
which is worse for a reader (and for an AI author working from these pages) than
a page that opens with its `Source:` pointer.

**Twenty reference pages lost an opening paragraph**, each of which was a
symbol's JSDoc rather than the module's: the six above plus `ai/solution-blueprint`,
`ai/tool`, `api/error-code-ledger`, `api/router`, `automation/approval`,
`cloud/template-manifest`, `data/driver-mysql`, `data/driver-postgres`,
`data/driver-sqlite`, `kernel/manifest`, `shared/enums`, `system/doc`,
`system/notification`, `ui/responsive`. **No page lost a real module header** —
the other 178 pages with a `Source:` line keep their description byte for byte.
A module that wants its opening paragraph back writes one block that documents
no symbol; 178 sources already do.

The rule is also the gate. The issue proposed failing on first sentences
matching `#\d{3,}` / `Shared history`, but that recognises only the
history-constant subclass, and only after publication — it would have caught two
of the six. A selection rule that cannot pick a symbol's comment makes the whole
class impossible instead. `scripts/lib/file-description.ts` (extracted from
`build-docs.ts`, following `format-type.ts` #4912 and `escape-mdx.ts` #5452) and
its pin suite `scripts/file-description.test.ts` carry it, corpus check included.
