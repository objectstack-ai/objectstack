---
'@objectstack/spec': patch
---

`KnowledgeSourceSchema`'s docblock stops claiming it is stored as metadata "exactly like a view or a flow", and says where a knowledge source actually lives

The docblock above `KnowledgeSourceSchema` declared, verbatim:

> Canonical KnowledgeSource. Stored as metadata, versioned, and
> environment-scoped exactly like a view or a flow.

None of the three is true, measured on the tree this changeset lands on:

- `listMetadataTypeSchemaTypes()` returns **26** governed metadata types and
  **none is knowledge-shaped**. Controls that fire: `view`, `flow`, `skill`,
  `agent` and `tool` are all present; a `zzz_nonsense` dark control is absent.
- `ObjectStackDefinitionSchema` has **44** top-level keys, none knowledge-shaped
  (controls present: `skills`, `agents`, `tools`, `views`, `flows`).
- `defineStack({ knowledgeSources: [...] })` is refused with the **generic**
  unrecognized-top-level-key message — byte-identical to the message for
  `zzz_nonsense`. Lit control: `defineStack({ skills: [<valid skill>] })` is
  accepted on the same base, so the probe does find an authoring route for a
  type that has one.

So an author who followed the sentence reached for a mounting that does not
exist and got a rejection that pointed nowhere — the authoring trap, not a
wrong example.

**The prose was the outlier, not the schema.** No ADR in this repo mentions
`KnowledgeSource` at all, and the rest of the contract is already consistent:
`IKnowledgeService` declares `registerSource` / `unregisterSource` /
`listSources` / `getSource`, `KnowledgeServicePlugin` takes a `sources` option
at kernel wiring and calls `registerSource` for each, and the implementation
holds them in a process-lifetime `Map`. The `agent.knowledge` liveness row says
the same thing from the other side — *"restrict retrieval at the
knowledge-service/source level; describe grounding in `instructions`"*.

The replacement docblock states what the schema is (the shape of a runtime
registration), names both routes a source actually arrives by, and says the
retrieval restriction is per-source at the service level.

⛔ No behaviour, no key and no accept set changes: the diff is one docblock.
Running `gen:schema` and `gen:docs` afterwards produced no artefact change —
`content/docs/references/ai/knowledge-source.mdx` mirrors the file-level header
docblock, not this per-schema one.

**Why this is not `skip-changeset`.** `@objectstack/spec`'s published `files[]`
ships `dist` *and* `src/**/*.zod.ts`, so this text is published twice over: the
old sentence was measured in the built `dist/knowledge-document.zod-*.d.ts` and
`.d.mts` (1 occurrence each) before the edit, and the source file is shipped
verbatim. Both move.
