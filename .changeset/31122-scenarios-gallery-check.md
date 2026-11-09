---
'@objectstack/scenarios': patch
---

feat(scenarios): `export-gallery --check DIR`, the mechanical check a PR on objectstack-ai/gallery must pass

Clause-②: no
Metadata-protocol: none

- **`export-gallery --check DIR`** reads a gallery tree and prints one `CODE PATH: MESSAGE` line per finding, exiting 1 on any and 0 on a clean tree. It writes nothing. It fails a tree when `index.json` does not match the exporter's own schema, when an entry has no complete `apps/<id>/` directory (README, run record, scorecard, transcript, `source/objectstack.config.ts`, at least one screenshot with every listed one on disk and none unlisted), when a directory under `apps/` is not listed, when a `framework.version` is not a stable `@objectstack/cli` release published on npm, and when the tree holds a `.env*` name, a `node_modules` directory, a symbolic link or a text file naming a local absolute path. An absent `index.json` is an empty gallery.
- It runs from a checkout (`pnpm --filter @objectstack/scenarios export-gallery --check DIR`) and from the published command line (`npx @objectstack/scenarios export-gallery --check DIR`), which loads it lazily from its own built entry, so `help` and `version` still load nothing else.
- **`@objectstack/scenarios/export`** also exports `checkGallery`, `mainCheck`, `npmPublishedVersions`, `renderFinding`, `FINDING_CODES` and `LOCAL_PATH`. The app layout, the framework package and the stable-version shape move into one shared module that the exporter, the refresh and the check all read; their exports are unchanged.
