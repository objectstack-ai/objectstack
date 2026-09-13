---
"@objectstack/spec": patch
---

fix(spec): the `protection` block's unknown-key refusal now names the surface, lists the declared keys and suggests the rename (#16845)

`ProtectionSchema` (`shared/protection.zod.ts`) was a bare `z.object({ … }).strict()` with **no error map**, so an unknown key inside a `protection:` block was refused with zod's own default text and nothing else:

```
AgentSchema.safeParse({ name: 'a', protection: { lockk: 'system' } })
  ✗ protection: Unrecognized key: "lockk"
```

`lockk` is one keystroke from the declared `lock`, and the author — human or AI, whose whole correction loop is the error text — was told the key was wrong and given no surface name, no declared-key list and no rename. The block is mounted on very nearly every authorable metadata type in the platform (objects, views, dashboards, datasets, reports, apps, flows, webhooks, permissions, positions, email templates, agents, tools, skills), so that was the message everywhere a protection key was misspelled.

It is now built with the `strictObject` helper — the same conversion #16328 made for the manifest `permissions` block — and answers:

```
  ✗ protection: Unrecognized key(s) on the `protection` block of this metadata item: `lockk`.
    Did you mean `lockk` → `lock`? … The declared keys are `lock`, `reason` and `docsUrl`.
```

Curated alongside it: prose-slot aliases (`description` / `message` / `explanation` / `lockReason` → `reason`), documentation-link aliases (`docs` / `link` / `url` / `href` / `helpUrl` / `documentationUrl` → `docsUrl`), a wrong-layer prescription for the field-level `readonly` / `readOnly` booleans (which map to a `lock` *policy*, not a boolean), and one prescription for the whole private `_lock*` envelope family. Two of those aliases correct a measurably **wrong** answer: the edit-distance fallback used to point `docs` and `link` — each two edits from `lock` — at the lock policy rather than at `docsUrl`.

**Not a breaking change: the accept set does not move.** `strictObject(options, shape)` is `z.object(shape, { error }).strict()`, and a zod error map is consulted only for an issue already being raised, so it can neither admit a value that was rejected nor reject one that was accepted. Measured rather than argued — the same parse probe across the declared key set, every accepted input, and every rejection's issue `code` reads byte-identical before and after.
