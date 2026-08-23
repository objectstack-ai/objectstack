---
'@objectstack/service-settings': patch
---

Tell the operator where `@objectstack/knowledge-turso` comes from instead of
naming a package this repo does not build

An operator who selects the `turso` knowledge adapter in **Settings → AI &
Embedder** and runs the connection test was told: "Mount
`@objectstack/knowledge-turso` to exercise live calls." That package is in no
directory of this repo (0 path hits on `main`; `knowledge-memory` and
`knowledge-ragflow` return 8 each under the identical command, so the zero is
real), and the message said nothing about where it does come from — leaving the
instruction un-followable at exactly the moment it is read.

The prior question the card turned on — *is it published anywhere?* — is now
measured rather than assumed. Against the public npm registry on 2026-08-23,
with `@objectstack/spec` and `@objectstack/cli` as positive controls and
`@objectstack/security-enterprise` as a known-private negative control:
`@objectstack/knowledge-turso` **is published**, `latest` 6.9.0 (2026-05-27),
nine versions from 6.4.0. So the option stays — dropping it would have deleted a
working adapter.

What it is *not* is co-installable with this platform version: 6.9.0 exact-pins
`@objectstack/spec@6.9.0` while this repo ships 17.2.0, so mounting it resolves a
second spec rather than reusing this one. The runtime message now names the
package, says this platform does not ship it, points at the ObjectStack Cloud
monorepo where it is built, and tells the operator to check for a release
matching their platform version — the framework#3366 discipline that an install
hint must carry its own edition/version boundary.

The manifest's adapter-list comment loses the undated "mirrors the plugin
packages currently published" claim that stopped being true with nothing to
catch it, and gains the measurement with its date and method so the next reader
can re-run it. No behaviour change: `ok` and `severity` are untouched on every
branch of the test action.
