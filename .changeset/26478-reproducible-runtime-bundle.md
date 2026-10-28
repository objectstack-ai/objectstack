---
'@objectstack/cli': patch
---

fix(cli): `os build` writes the same legacy runtime module for an unchanged app, so its content-hashed name and the artifact's `runtimeModule` ref stop changing on every rebuild

Clause-②: no
Metadata-protocol: none

The legacy runtime module (`dist/objectstack-runtime.HASH.mjs`) is named by a hash of its bytes, but those bytes used to differ on every build. The build wrote a temporary esbuild entry beside the config under a name made of the process id and the current time, and esbuild prints each input's path into the module, as a comment above its code and in the inline sourcemap. Those paths were also relative to the directory `os build` ran from. So every rebuild of an unchanged app shipped a new file name and a new `runtimeModule` ref in `dist/objectstack.json`, and building the same app from another directory or another checkout did too.

The entry is now handed to esbuild in memory under one fixed name, and every path in the module is relative to the config's own directory. Two builds of an unchanged app now ship byte-identical modules under one name, wherever they run. No temporary file is written next to the config any more. The module's exports and behaviour are unchanged.
