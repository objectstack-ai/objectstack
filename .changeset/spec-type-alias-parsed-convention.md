---
"@objectstack/spec": minor
---

feat(spec): name the parsed state `XParsed` on every schema that has one (ADR-0122, #5551)

A Zod schema denotes two types — `z.input` (what an author writes: defaulted keys
optional, pre-transform) and `z.infer` (what `.parse()` returns) — and `packages/spec`
has been naming them two different ways with nothing written down about which is which.
Measurement on `origin/main`: **1384** bare aliases mean the parsed state, **86** mean
the author state, and three separate first-hand sources each described the 8-file
minority as "the house convention". No ADR recorded either spelling.

**[ADR-0122](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0122-schema-type-alias-naming-convention.md)
settles it: the bare name `X` is the AUTHOR state, `XParsed` is the PARSED state.** The
deciding argument is the keystroke every author writes first — `const c: Connector = { … }`
— which should be correct by default in every domain, without knowing which file you are in.

**This release is phase 1, and it is purely additive. Nothing is renamed or removed;
no existing annotation stops compiling.** It declares `XParsed` for the **657** aliases
whose schema genuinely has two distinct shapes, so that every consumer whose meaning
phase 2 will change already has a name to move to:

```ts
// before — one name, meaning the parsed state
export type Connector = z.infer< typeof ConnectorSchema >;
export type ConnectorInput = z.input< typeof ConnectorSchema >;

// after — the parsed state also has a name that will keep meaning it
export type Connector = z.infer< typeof ConnectorSchema >;
export type ConnectorParsed = z.infer< typeof ConnectorSchema >;   // new
export type ConnectorInput = z.input< typeof ConnectorSchema >;    // unchanged
```

Schemas whose `z.input` and `z.infer` are the *same* type (enums, plain unions, objects
with no defaults or transforms anywhere in their tree) deliberately get **no** `XParsed`
— a permanent synonym is a name you can only pick wrongly. All 718 of them are pinned
with compile-time assertions so the exemption cannot rot silently when one later gains
a `.default()`.

One name to note if you are upgrading across protocol 17: `FieldMapping` does **not**
gain a `FieldMappingParsed`. #5552 retired `FieldMapping.transform` and the whole
`FieldMappingTransform` union in the same release, and that key was the only reason the
schema had two shapes — so it is now isomorphic, and under this convention it correctly
keeps exactly one name.

**What to do now (optional, and cheap).** If you hold the result of a `.parse()` — or of
a `defineX()` factory, which returns it — move that annotation to `XParsed`:

```ts
-const c: Connector = ConnectorSchema.parse(raw);
+const c: ConnectorParsed = ConnectorSchema.parse(raw);
```

Annotations on values you *write* need no change now and will be correct after phase 2.
Doing nothing is also fine until then.

**What comes next.** Phase 2 flips the bare names to `z.input` and ships in a major, with
its own changeset and migration notes. `XInput` aliases are untouched by this release and
their fate is decided then.
