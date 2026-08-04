---
"@objectstack/spec": patch
---

fix(spec): the authorable-surface deletion gate no longer needs network to build (#5235)

`gen:schema` anchors the #4650 deletion check on `authorable-surface.json` at the merge
base with `origin/main` — the one version of that file the commit under test cannot
rewrite. When `origin/main` could not be resolved (and the self-heal `git fetch` could not
make it resolvable), the build failed:

```
❌ Cannot resolve origin/main to anchor the authorable-surface deletion check (#4650).
```

That is correct for a developer who forgot to fetch, and wrong for an entire class of
build environments that have no route to GitHub at all: image-build stages that copy a
SHA-pinned framework tree into a container and build it there, air-gapped builds, forks,
and historical-tag reproductions. Those trees are immutable and already merged — there is
no "what did this PR delete relative to main" question to ask — yet the gate failed them
anyway. It blocked every downstream consumer that builds `@objectstack/spec` from a pinned
checkout without network.

The baseline is now also committed to the tree as `packages/spec/authorable-surface.base.json`:
the keys of `authorable-surface.json` as of `baseRev`, a commit on `origin/main`.

- Where `origin/main` is reachable (every dev checkout, every CI run) nothing changes: the
  gate still anchors on the merge base, and it additionally verifies the committed anchor
  against it — `baseRev` must be an ancestor of `origin/main` and the recorded keys must
  be that commit's baseline. So a commit cannot edit the anchor to hide a deletion; the
  environments that can check, do.
- Where `origin/main` is not resolvable, the gate anchors on the committed file and the
  build proceeds. It still runs: a key the anchor records that the build no longer emits
  is as fatal as before. Only an authoritative anchor may write the file, so an offline
  build can never advance it to its own state.

There is deliberately no environment-variable skip — a deletion check that can be switched
off is the bypass #4650 exists to close. With neither anchor available the build still
fails.
