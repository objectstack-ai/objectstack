---
"@objectstack/cli": minor
---

fix(cli): the upgrade advisory reads `manifest.engines.protocol`, the axis that is actually declared (#13860)

`os validate`, `os doctor` and `os compile` all print a non-blocking advisory pointing
at the per-major migration guide when the installed platform has moved ahead of the app.
All three read it off `manifest.specVersion` — a key `ManifestSchema` does not declare.
`ManifestSchema` is not `.strict()`, so an author who wrote `specVersion` had it accepted
and dropped with nothing said, and the advisory could therefore only ever fire for a
manifest carrying a key the schema does not offer. It was dead for stack configs for its
whole life: the "breaking-change guidance the author should read before proceeding" that
its own header describes was never once delivered.

The advisory now reads `manifest.engines.protocol` — declared by `PluginEnginesSchema`,
stamped by every scaffold and example (`engines: { protocol: '^17' }`), and already
enforced at boot by the ADR-0087 handshake. One declared version axis instead of one
declared axis and one phantom.

`specVersion` is retired from the stack config's CLI vocabulary. It keeps its meaning on
the marketplace **template** manifest (`objectstack.manifest.json`, `cloud/TemplateManifest`),
which is a different surface and is untouched — the name means one thing in one place and
nothing in the other, which is the status quo stated honestly rather than a new debt.

## The verdict comes from the platform's own handshake

The range is judged by `checkProtocolCompat` from `@objectstack/metadata-core` rather
than by a leading-integer parse of the CLI's own. That module is the single reader of
this axis — it owns the source priority (`engines.protocol` → `engines.platform` →
legacy `engine.objectstack`) and the range grammar — and its header already records why:
two readers with two priority orders would be the "two opinions" defect. A private parse
would have been the third, and it would disagree exactly where it matters: `>=15 <18`
targets 15 but *admits* 17, so a naive reading advises an upgrade against a range that
already covers the installed platform. Delegating means the advisory fires precisely when
boot would refuse the app, which is what makes it guidance rather than noise. The
advisory names the key it actually read, so an author is never told to bump a key they
did not write.

Comparing a protocol range against the `@objectstack/spec` resolved from the app's
`node_modules` is sound because `PROTOCOL_VERSION` is held in lockstep with that
package's major (`protocol-version.test.ts` fails on drift), which is also what keeps
the `docs/releases/v<major>` link correct.

## What changes for you

Nothing is removed or renamed on a published surface, and no command's accept set or exit
status moves: the advisory is print-only, `os validate` keeps it outside `--strict` on
both faces, and `os doctor` never exited on warnings. The `--json` payload key stays
`specVersionGap` with its value shape unchanged.

What does change is that the advisory now **fires**. An app whose `engines.protocol` is
behind the installed platform will start seeing the migration-guide pointer from all three
commands, and `os doctor` will summarise that run as "functional but has some warnings"
rather than "healthy". That is the check finally doing its job; if it speaks up, the drift
it names was already there.
