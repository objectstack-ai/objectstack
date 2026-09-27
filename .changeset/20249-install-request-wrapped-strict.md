---
'@objectstack/spec': minor
---

fix(spec): `PackageInstallRequestSchema`'s wrapped branch refuses an unknown top-level key by name (#20249)

Clause-②: no (narrowing)

**BREAKING for callers of the install door** — a WRAPPED install body
(`{ manifest, … }`) that carries any top-level key the declaration does not
name is now refused `400` / `VALIDATION_ERROR` at `POST /api/v1/packages`, and
`PackageInstallRequestSchema` / `PackageInstallBodySchema` refuse it at parse.
It used to parse green with the key silently DROPPED, and the door installed
the package and answered `201`.

This one narrows the declaration itself. The manifest and the bare form (a
manifest as the whole body) already refused an unknown key by name; the wrapped
top level was the one position of the install contract still declared strip
mode. The sharp case is a misspelled option: `{ manifest, enabledOnInstall:
false }` had `enabledOnInstall` dropped, so the package was installed
**ENABLED** — the caller's explicit `false` inverted, with no word said. The
wrapped branch is now a `strictObject`, like the other two positions: one rule
for the whole install contract (decision batch #227 item 3, letter A; ruling
record `5856869656`). No alias and no grace window.

The install door needs no edit and gets none: since the door started parsing
its whole body through `PackageInstallBodySchema`, it answers exactly what that
declaration says, so the refusal reaches `POST /api/v1/packages` the moment the
declaration moves. The same fact retires the sentence that had forbidden this
close — «the declaration must not refuse a body the door answers `201` to» held
only while the door did not parse its body.

**What is not affected.** A wrapped body carrying only `manifest` and the
declared install options — `settings`, `enableOnInstall`, `overwrite`,
`platformVersion`, `artifactRef` — parses and installs exactly as before, and so
does a bare manifest. Boot-time and in-process installs reach
`SchemaRegistry.installPackage` / `ObjectQL.registerApp` directly and never pass
through this declaration.

**Reach, measured first-party.** The SDK's `client.packages.install` sends only
`manifest`, `settings`, `enableOnInstall` and `overwrite`, and the objectui
package dialog sends only `{ manifest }`; neither breaks.
**Out-of-repo callers are NOT MEASURED** — there is no telemetry on them, so a
caller that sends its own private top-level key (a trace id, a source tag) now
gets a `400` naming that key. Check your own callers before upgrading rather
than inheriting this result.

**Migration — FROM → TO.** The refusal names the key and, for a near-miss,
offers the declared one, so the prescription arrives with the `400`:

- A misspelled option: FROM `{ "manifest": { … }, "enabledOnInstall": false }`
  TO `{ "manifest": { … }, "enableOnInstall": false }` — respell it as the
  declared option it meant.
- Any other undeclared top-level key: FROM `{ "manifest": { … }, "_source":
  "studio" }` TO `{ "manifest": { … } }` — remove it. There is no place on this
  request to carry it.

It is registered as an ADR-0087 structured TODO rather than a conversion: an
unknown key has no mapping target, and deleting it automatically would repeat
the silent drop this change closes.

<!-- adr-0087: registered package-install-request-unknown-keys-refused -->
