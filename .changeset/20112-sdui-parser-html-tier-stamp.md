---
'@objectstack/sdui-parser': minor
'@objectstack/console': minor
---

The SDUI manifest now marks the html tier's intrinsic tags `tier: 'html'`, and this copy of the parser carries that marker the way the renderer's copy does.

objectui's copy of `packages/sdui-parser` gained the marker when its registry started declaring the intrinsic HTML tags a `kind:'html'` page may author (`h1`–`h6`, `p`, `a`, `code`, `span`, `table`, the sectioning tags and the rest of the roster; never `div`). This copy still declared only `'public' | 'internal'` and dropped the key. The repo-root `sdui.manifest.json` is serialised through this copy, and `@objectstack/console` ships it in its `dist`, so the published manifest listed those tags with no marker. A reader could not tell them from curated blocks. The port is byte-faithful to objectui at the console pin `dd3f7e1be356`:

- `RegistryConfigLike.tier` accepts `'html'`, the stamp objectui's `getPublicConfigs()` puts on the roster in its projection.
- `ManifestComponent.tier?: 'html'` is new. `manifestFromConfigs` writes exactly `'html'` or omits the key, so every other entry serialises byte-identically to before.
- `generateBlockList` counts only curated blocks in its title and lists the html tier in a section of its own.

**What moved in the published manifest:** `"tier": "html"` on 48 entries, and nothing else. It still has the same 107 components in the same order, and no other field on any entry changed.

**What did not move:** `compile()` and `validateTree()` read the manifest as a whitelist of keys and never read `tier`. So no page's verdict changes. Measured on the three shipped `kind:'html'` pages of `examples/app-showcase`: the full `compile()` result is identical against the old and the new manifest.
