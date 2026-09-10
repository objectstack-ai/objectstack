---
"@objectstack/rest": minor
---

refactor(rest)!: `ImportProtocolLike` declares the request each of its three required members receives, instead of `args: any` (#16952)

The exported extension point `runImport` accepts a protocol through now states its own contract.

**FROM** — every required member erased its parameter, so the interface declared nothing about the request it would hand an implementor:

```ts
export interface ImportProtocolLike {
  findData(args: any): Promise<any>;
  createData(args: any): Promise<any>;
  updateData(args: any): Promise<any>;
}
```

**TO** — each member names the declared spec request, wrapped in the server-scoped envelope the runner adds (`ImportProtocolRequest`, exported alongside):

```ts
export type ImportProtocolRequest<R> = R & { context?: any; environmentId?: string };

export interface ImportProtocolLike {
  findData(args: ImportProtocolRequest<FindDataRequest>): Promise<any>;
  createData(args: ImportProtocolRequest<CreateDataRequest>): Promise<any>;
  updateData(args: ImportProtocolRequest<UpdateDataRequest>): Promise<any>;
}
```

**Why this is breaking-ish, and released as `minor`.** This is a narrowing of a published surface: an implementor that compiles today may stop compiling. Nothing about the values the runner sends changes — the request objects are byte-for-byte the ones #16638 already made canonical — so no runtime behaviour moves. What changes is that the compiler now holds an implementor to the same `QuerySchema` the runner is held to: `where` / `limit` / `offset` / `fields` / `orderBy` / `expand` are declared, and the wire spellings `$filter` / `$top` are not.

**Migration for implementors.** If your `findData` / `createData` / `updateData` reads a wire alias, it will now fail to compile — that diagnostic is the point of this change, and the fix is to read the canonical key:

```ts
// before — compiles, and silently degrades to match-everything when `$filter` is absent
async findData(args: any) {
  const where = args?.query?.$filter ?? {};
  const limit = args?.query?.$top ?? 2;
}

// after — drop your own annotation and let the declaration type the parameter
async findData(args) {
  const where = args.query!.where;
  const limit = args.query!.limit;
}
```

⛔ An implementor that keeps an explicit `args: any` annotation of its own opts back out: the annotation wins over the contextual type, and the contract reaches nothing. Leave the parameter unannotated, or name `ImportProtocolRequest<FindDataRequest>` explicitly.

⚠️ The `?? {}` shape in the "before" is the mechanism that made a dialect mismatch silent rather than loud: an unrecognised query does not throw, it degrades into a filter that constrains nothing, so a duplicate probe stops discriminating and an upsert updates the wrong record. Prefer a read that throws.
