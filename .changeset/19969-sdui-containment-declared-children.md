---
'@objectstack/sdui-parser': patch
---

fix(sdui-parser): `not-a-container` is decided by the declared `children` input, not `isContainer`. This matches the renderer's copy of the parser (#19969)

The save gate's `validateTree` now warns `not-a-container` on a child list only when the component's manifest entry declares no input named `children`. It never reads `isContainer`, which now means layout containment only, and it has no fallback to it. This is a port of objectui#9910 (objectui `5ea623ea`), which is already inside the pinned console build. Saving and rendering now reach the same verdict on every page again.

Against the served `sdui.manifest.json`, five of its 59 components change:

- `badge`, `alert`, `button` declare a `children` slot and are not flagged `isContainer`. A child list under them no longer draws a false `not-a-container` warning.
- `page:tabs`, `page:accordion` are flagged `isContainer` but declare no `children` input. They render `items[].children`, never `schema.children`, so a child list under them now draws the warning the flag used to silence.

Clause-②: no

`not-a-container` stays a `warning`, so the default save gate refuses no page it accepted before and accepts no page it refused. Only the two modes that treat warnings as errors see the five-component change: `os validate --strict` and `os lint --strict`. Both run `validateJsxPages`. The package's public entry adds no export.
