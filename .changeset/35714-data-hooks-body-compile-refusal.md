---
'@objectstack/skills': patch
---

docs(skills): the hooks skill says a hook or job `js` body that does not compile is refused, and how to fix it

Clause-②: no
Metadata-protocol: none

objectstack-data's `references/data-hooks.md`, "Sandbox restrictions":

- A new bullet says a `js` source is compiled, without being run, inside the `(async (ctx) => { … })` wrapper the runtime runs it in, where `ctx` is already declared. `const ctx = ctx.input || {};` (or `let ctx`, one name declared twice, any syntax error) is `hook-body-does-not-compile`: an error from `os validate`, `os build`, `os lint` and a runtime hook save (`422 INVALID_METADATA`), naming the hook, the `SyntaxError` and its line. The fix is to use `ctx` as it is or rename the local (`const input = ctx.input || {};`). A job's `js` body runs in the same wrapper and is `job-body-does-not-compile` from the three commands. A regular-expression pattern only the checking engine refuses is a warning.
- Six restatements in the same file were removed to pay for the new text; the file is three lines and five tokens shorter than before.

`evals/hooks-security-seeds-datasources.json` gains one case on the refusal and its fix.
