---
'@object-ui/app-shell': patch
---

chore(ui)!: `@object-ui/app-shell` is no longer published to npm (#25922)

Clause-②: `yes (narrowing)`: a published package leaves the registry; ADR-0087 marker per the lane's rules
Metadata-protocol: none

**BREAKING** for anyone who installs `@object-ui/app-shell` from npm. The package exists to serve the ObjectOS Console, and a customisable console for a third-party host has no business demand today, so the package is now `private: true` and leaves the Changesets `fixed` group. `18.2.0` is the last published `@object-ui/app-shell`: the 18.2 Version PR versioned it before this change and the 18.2 publish ships it; no later version reaches npm, and the maintainer deprecates the package on npm after the 18.2 publish. Nothing else moves: the Console (`ui/apps/console`) and the `@object-ui/*` packages that import it are workspace consumers and keep importing it exactly as before, and its exports, views and Studio pages are unchanged.

The host-console posture leaves the repository with it. The two examples that imported the package as a host would, `ui/examples/byo-backend-console` and `ui/examples/console-starter`, are deleted, and so is `ui/docs/app-shell-extraction-guide.md`, the guide to extracting the package into a host. The READMEs, the examples index and the contributor docs that pointed at them no longer do.

Migration: there is no replacement package. `@object-ui/app-shell` FROM npm → TO none. A host that installs it stays on `@object-ui/app-shell@18.2.0`, the last published version, or runs the ObjectOS Console instead of embedding the shell.

<!-- adr-0087: not-required (unpublished) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the npm registry: `@object-ui/app-shell`, the one package this changeset bumps, is `private: true` from this change on and publishes nothing, and its last published version, `18.2.0`, stays on npm until the maintainer deprecates it after the 18.2 publish. -->
