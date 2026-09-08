---
"@objectstack/rest": patch
---

The REST server's own `findData` calls now build the canonical QueryAST instead of an undeclared wire dialect, and the helper that erased the type on that one slot is gone.

Four server-built query literals in `rest-server.ts` — the import-job loader, the import-job listing, the export chunk loop and the public reference picker — spelled their query in transport aliases (`$filter`, `$top`, `$skip`, `$orderby`, `$expand`, plus the bare `filters` / `select` / `sort`). None of those spellings is declared by `QuerySchema`, so three of them were routed through a `wireDialectQuery` helper that cast the `query` member to `FindDataRequest['query']`, and the fourth escaped the compiler entirely because its protocol handle was typed `any`. All four now spell `object` / `where` / `orderBy` / `limit` / `offset` / `fields` / `expand`, so the slot compiles against the declared contract like every other member of the request, and the helper is retired.

**No behaviour moves, and that is measured rather than asserted.** `@objectstack/metadata-protocol`'s `findData` folds every alias onto its canonical key by the spec's own table (`RPC_QUERY_ALIAS_SLOTS`) and moves the value verbatim, so both spellings reach `engine.find` as the same option bag. `rest-server-canonical-query-ast.test.ts` drives all four before/after pairs through the real normalizer and asserts that equality, and reads the source to keep the erasure retired — a cast compiles, so a type-check alone could not hold this ground.

**Nothing is removed from the published surface.** `wireDialectQuery` was a module-local `const` in `rest-server.ts`: it carried no `export` keyword, `packages/rest/src/index.ts` never named it, and it appeared in no other file in the tree. Deleting it moves no exported symbol, which is why this is a patch.

**What this change deliberately does NOT do:** it does not touch how the HTTP door treats a *caller's* query. The wire aliases stay accepted on `GET /data/:object` exactly as before — declaring them in the spec's alias table is a separate piece of work — and `GET /data/:object` still forwards the caller's own querystring bag untouched.
