---
'@objectstack/spec': minor
---

fix(spec): the save door refuses an undeclared text key asked for as `ctx.text?.('k')` or `ctx.text!('k')`, as it already did for `ctx.text('k')`

Clause-②: no (narrowing)
Metadata-protocol: narrowed

**BREAKING** for a hook or a `type: 'script'` action that declares `texts` and whose code asks for a key `texts` does not declare through the optional-call or non-null shape.

- FROM: `HookSchema` and `ActionSchema` refused a key asked for literally and not declared in `texts` only for the plain call `ctx.text('k')`. `await ctx.text?.('k')`, `ctx.text?.('k')`, `await ctx.text!('k')` and `ctx.text!('k')` with an undeclared key parsed green, and the runtime refused the key only when the hook or action ran.
- TO: each of those shapes is refused at save with the sentence the plain call already gets, at `body.source` (or `handler` for an in-process hook handler). Whitespace around the operator is read too (`ctx.text ?. ('k')`, `ctx.text !('k')`); a `!` on the next line ends the statement and is not a call.
- Fix: declare the key under `texts.KEY` with the sentence the record keeps, or ask for one of the declared keys. A declared key is accepted in every shape.

A key that arrives any other way (a variable, a computed name) is still judged when the code runs.

<!-- adr-0087: registered hook-action-text-key-optional-call-refused -->
