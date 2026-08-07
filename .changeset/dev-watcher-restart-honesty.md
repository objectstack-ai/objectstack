---
"@objectstack/cli": patch
---

fix(cli): `objectstack dev` restarts the server after each rebuild — the running server can no longer silently disagree with `dist/objectstack.json` (#5148)

The dev watcher rebuilt `dist/objectstack.json` on every source change and
printed `✓ recompiled — server will auto-reload`, but the running serve child
only **partially** received the rebuilt artifact: MetadataPlugin's own
artifact watcher re-ingests the metadata registry, syncs DDL + seeds for
newly-appearing objects and broadcasts the SSE HMR event — while hook bodies
and already-registered view metadata from the compiled bundle are applied at
**boot only**. #5148 measured both staying stale: the old hook kept executing
and `/api/v1/meta/views` kept serving the old view after a confirmed on-disk
rebuild, with no error and no warning. That made every dev edit/verify loop
capable of a false conclusion in either direction ("my fix doesn't work" /
"this code isn't load-bearing").

`objectstack dev` now supervises its serve child nodemon-style:

- **Auto-restart (default-on).** After a rebuild lands on disk, the serve
  child is SIGTERMed (the kernel shuts down gracefully), and a replacement is
  spawned once it exits — boot-time load is the one path that applies the
  whole artifact. Restarts coalesce (rapid saves produce one restart), a
  child that ignores SIGTERM is force-killed after 8s, a replacement that
  fails to come up is loud and exits dev, and parent SIGINT/SIGTERM is
  forwarded to the child so no orphan server outlives dev.
- **`--no-restart` opt-out.** The watcher then only rebuilds the artifact —
  and every rebuild now says explicitly that the running server keeps the
  build it booted with. The watch banner states the active mode instead of
  implying a hot reload the runtime only partially performs.
- **Boot-time staleness warning (#5148 startup variant).** When
  `objectstack.config.ts` / `src/**` are newer than the artifact at boot
  (edited while the server was down), dev warns loudly that the boot serves
  the stale build, names the newest source file and the remedy
  (`objectstack build`, `--compile`, or save a watched file). The boot is
  never gated — the silence is removed, not the start.
