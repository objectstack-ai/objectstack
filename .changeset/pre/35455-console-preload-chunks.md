---
'@object-ui/console': patch
---

perf(console): a page load requests the code it needs in one wave

Clause-②: no
Metadata-protocol: none

The console's built `index.html` named five of the files every page load runs; the browser found the rest only after downloading and parsing the files that import them, wave after wave, before the first authenticated request could leave. Opening a list or a record page did the same with the page's own code: the route chunk's imports arrived level by level, and the page asked for its data after the last one. Each wave is one more round trip, which is what a hosted console far from its users pays for.

`index.html` now preloads every file a page load runs, and opening a page preloads the whole closure of that page's code beside the page chunk. Nothing is downloaded that was not downloaded before, and nothing moves between chunks; only the time a file is requested changes. A build-time check fails the console build when a file a load needs would again be found only after the file that imports it.
