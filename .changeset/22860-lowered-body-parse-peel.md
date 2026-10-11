---
"@objectstack/cli": patch
---

fix(cli): `objectstack build` reads a lowered hook or action body off the handler's parse, so a `}` in a string, a statement-level inner arrow or a `function` handler with a pattern parameter no longer ships a body that is not the handler's

Clause-②: no

When `objectstack build` lowers an inline handler to a metadata `body`, it ships the handler's statements as `body.source`. It found those statements by counting `{` / `}` and `(` / `)` through the handler's text, with no idea of what a string, a template literal, a regular expression or a comment is, and it took the first parenthesised `=>` anywhere in the text as the handler's header. So ordinary handler code shipped a body that is not the handler's, and the build still exited 0. Measured through a real `objectstack build`:

- **A `}` inside a string, a template literal, a regex or a comment** cut the body off at that brace. `ctx.input.note = 'a}b'` shipped as `ctx.input.note = "a`, a `SyntaxError` on the body's first run.
- **A statement-level inner arrow** in a `function` handler (`const f = (a) => a + '!'`) was read as the handler, and the body was built around it, which is also a `SyntaxError`. With a block-bodied inner arrow, the inner arrow's own statements shipped: a body that runs and does none of the handler's work.
- **A `function` handler whose parameter is a pattern** (`async function ({ input }) { … }`) shipped the pattern as its body. After the parameter rebind that is `var { input } = ctx; input`. It throws nothing and stores nothing, where the in-process handler stores the row.
- **A `{` inside a string** left the count unbalanced, so the handler was refused as unparseable and bundled into the runtime module, with a warning telling the author to rewrite a handler that had nothing wrong with it.

The only signal for the first three was `os lint`'s `hook-body-source-unparseable` warning on the lowered body. It pointed the author at a syntax error their handler does not have, and the pattern-parameter case raised no signal at all.

The body is now read off the TypeScript parse of the handler: the statements between its block's own braces, or the expression of an implicit-return arrow. This is the same parse the parameter rebind and the free-identifier check already read. Every shape above now lowers to the handler's own body and runs as the handler does. The `{`-in-a-string handler is lowered instead of bundled. `hook-body-source-unparseable` no longer fires for any of them.

This applies to both faces, a hook's `handler` and an action's `target`. The action face still gets no parameter rebind.

**Unchanged.** A handler the old count read correctly lowers to the same bytes, comments and layout included. This was measured over 21,262 function texts from `packages/cli`, `examples` and `packages/qa`, and over the callables the `app-crm` and `app-todo` configs load. No refusal message is reworded. The hook face's separate "could not read the parameter list" refusal is gone: the body and the parameter list are now read off one parse, so a handler that parse cannot read meets the existing "could not parse the body" refusal instead. It is the same kind (`unparseable`) with the same remedy, and no measured handler reached the old one. `extractHookBody`'s published signature and refusal kinds are the same. No spec key, export, type or stored shape moves.
