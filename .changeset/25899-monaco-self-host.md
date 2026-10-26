---
'@object-ui/plugin-editor': patch
'@object-ui/app-shell': patch
'@objectstack/console': patch
---

fix(plugin-editor): the Console's code editor loads Monaco from its own build, never from cdn.jsdelivr.net

Clause-②: no
Metadata-protocol: none

The Studio's code editors (the JSON source tab, the html / react page source editor, the metadata form's code fields) and the `code-editor` page component fetched Monaco's core from `cdn.jsdelivr.net` at run time, through `@monaco-editor/loader`'s default config. An install with no route to that CDN, and every Console served under its content-security-policy (which lists no CDN in `script-src`), got a plain textarea instead, and the `code-editor` component stayed on "Loading..." for good.

- **`@object-ui/plugin-editor`:** `monaco-editor` is now a dependency, bundled by the host. The new `configureBundledMonaco(loader)` imports its ESM core as a lazy chunk and hands it to the loader with `loader.config({ monaco })` before the first `loader.init()`, so the loader injects no CDN script. Each language worker is imported through Vite's `?worker` when Monaco first asks for it, and starts from a same-origin file under the build's assets. The `code-editor` component mounts the editor only once that config has landed, and when the editor chunk cannot be fetched it edits the same text in a plain textarea instead of loading forever.
- **`@object-ui/app-shell`:** the code editors' one loader probe per page awaits `configureBundledMonaco` before `loader.init()`. The plain-textarea fallback stays for a chunk that cannot be fetched.
- **`@objectstack/console`:** the built Console carries Monaco as lazy chunks and worker files under `assets/` (about 13.5 MB of uncompressed JavaScript, loaded only on a screen that opens an editor); the first-paint closure is unchanged.

What to do: nothing. A host that bundles `@object-ui/plugin-editor` with a bundler other than Vite must handle the `?worker` imports itself.
