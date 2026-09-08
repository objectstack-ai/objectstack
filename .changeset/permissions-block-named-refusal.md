---
"@objectstack/spec": patch
---

The manifest `permissions` block's unknown-key refusal now names the surface and offers the rename, like every other block on the manifest.

`PluginPermissionsSchema` decides which services, hooks, network hosts and filesystem paths a plugin may touch. It has refused unknown keys since it was introduced, but through zod's own bare message: an author who transposed `hooks` as `hoooks` read `Unrecognized key: "hoooks"` — the key echoed back, with no surface name and no suggested spelling — while every neighbouring block on the same manifest (`contributes`, `contributes.kinds[]`, `engines`, the legacy `engine`, and the manifest root itself) named all three. Born closed at the ADR-0025 plugin-distribution work, it never passed through the unknown-key campaign that gave the others their error maps.

It now uses the same `strictObject` helper as its neighbours, so the refusal reads:

```
Unrecognized key(s) on the `permissions` block of this package manifest: `hoooks`.
Did you mean `hoooks` → `hooks`? …
```

Three spelled-out near-misses that edit distance cannot reach are curated as aliases: `filesystem` and `paths` point at `fs`, and `hosts` points at `network`.

**The accept set does not move.** `strictObject` is `z.object(shape, { error }).strict()` — the declared keys and the strictness are unchanged, and an error map is consulted only once an issue is already being raised. The `permissions` union keeps both arms (the legacy flat string list and the structured block), and the union itself is untouched. Only the text of a refusal that already happened is different.
