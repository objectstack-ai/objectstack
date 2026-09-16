---
"@objectstack/service-automation": patch
---

`try_catch`'s catch-region binding is annotated as the plain declared type. `TryCatchErrorValueSchema` declares `code: z.string().optional()`, so the local `TryCatchErrorValue & { code?: string }` intersection in `builtin/try-catch-node.ts` added nothing the exported `TryCatchErrorValue` did not already carry, and the comment paragraph beside it explained a spec/engine divergence that no longer exists (#15669).

**No behaviour change, and nothing executable moves.** The object literal is untouched: `nodeId`, `message`, `code` and `iteration` / `item` are bound under exactly the same conditions as before, so a catch region still branches on `{$error.code}` and still reads an absent `code` as "no classified code", never as "nothing failed". Measured on the built package: `index.js`, `index.cjs`, `index.d.ts` and `index.d.cts` are **byte-identical** before and after; only `index.js.map` / `index.cjs.map` shift (by one byte each), because the replacement comment is two lines longer and the sourcemap encodes line positions.

The annotation was proven redundant before it was removed — `TryCatchErrorValue` and `TryCatchErrorValue & { code?: string }` are mutually assignable, and `TryCatchErrorValue['code']` is exactly `string | undefined` — and the binding it describes is genuinely pinned: dropping `code` from the literal reddens the two `#14419` discriminator tests in `builtin/create-record-duplicate-code.test.ts`.
