---
"@objectstack/cli": patch
---

`os serve` (and `objectstack start`, which runs it) now says at boot when an app's branding logo or favicon will not be served. Before, the runtime assets route was skipped without a word when its directory was absent, so an artifact booted outside its project directory drew a broken logo and favicon and nothing in the boot output said why.

Clause-②: no

- Once the boot settles, every loaded app whose `branding.logo` or `branding.favicon` is a root path under `/runtime/assets/` that the route will not serve gets one warning line per file. The line names the apps and keys that use the file, the directory searched, and whether that directory came from `OS_RUNTIME_ASSETS_DIR` or the `assets/` default under the working directory. When the directory does not exist, the line says so and says nothing under `/runtime/assets/` is mounted for this run.
- The apps read are the ones the console is served, through the same metadata protocol read that `GET /api/v1/meta/app` answers from. Config boots and artifact boots are both covered.
- Whether a file is servable is decided by the route's own filename resolution, so the warning and the route cannot disagree. Absolute URLs, protocol-relative URLs, data URIs, relative paths and other root paths are not checked.
- The line goes through the kernel logger at `warn`. It shows in the banner's *Boot diagnostics* block, streams live at `--log-level debug` or `info`, and is hidden at `error` or `silent` like every other boot warning.
- ⛔ What `/runtime/assets/*` serves does not change. No route is added or removed, and the artifact still carries no asset files: ship the `assets/` directory beside it, or point `OS_RUNTIME_ASSETS_DIR` at the files.
