---
'@objectstack/metadata': patch
---

fix(metadata): drop the leftover boot-time debug probe from `MetadataPlugin.init` (#14527)

`MetadataPlugin.init()` printed a bare `console.log` immediately after
`ctx.registerService('metadata', this.manager)`, reporting
`typeof this.manager.getRegisteredTypes`. Nothing gated it on `NODE_ENV`, a debug
flag or a logger level, so every kernel boot that installs `MetadataPlugin` wrote
it to stdout: the CLI, the dev server and any embedding host alike.

What it printed was a probe, not information. `getRegisteredTypes` is a method the
class declares statically, so the `typeof` it reported cannot vary in a way an
operator could act on, and a repo-wide search finds no reader of the string. The
`ctx.logger.info('Initializing Metadata Manager', ...)` call three lines above
already announces the same lifecycle step through the plugin's own logger, carrying
the fields that are actually actionable (`root`, `watch`, `artifactSource`). Deleted
rather than demoted to `ctx.logger.debug` on that reading: once the reported fact is
statically known and unread, there is no shape check left worth keeping.

Observable change: one fewer line on stdout at boot. No API, no types, no behaviour
beyond the removed print. On the two paths where a stray stdout line would break a
parser — `--json` payloads and the `os serve` protocol channel — the CLI already
reserves stdout by redirecting to stderr, so nothing downstream was relying on this
line's presence or its absence.

The file's five other `console.*` calls (the dev HMR path) are deliberately
untouched: each carries its own marker, and the one that prints on every
non-development boot carries a written rationale for doing so.
