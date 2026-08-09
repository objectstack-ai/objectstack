---
"@objectstack/spec": minor
"@objectstack/cli": minor
---

feat(spec,cli): carry the package namespace on the publish payload (#6760)

ADR-0048's addendum defines a publish-time namespace exclusivity registry
(`namespace → publisher`), so a cross-vendor namespace collision is caught while
exactly one party can still fix it cheaply — the publisher, before anything ships
— instead of surfacing at install time, where the tenant who suffers it can do
nothing. That gate is enterprise-side (Phase A2), and it could not be built
because the namespace never left the artifact: `PackageSchema` had no
`namespace` field at all, `CreatePackageRequestSchema` did not accept one, and
`objectstack package publish` transmitted `manifest_id` only. This is Phase A1,
the open-side half that gives the gate an input.

**`PackageSchema` and `CreatePackageRequestSchema` gain an optional
`namespace`.** It mirrors `manifest.namespace` exactly — same 2-20 character
rule (`/^[a-z][a-z0-9_]{1,19}$/`), same optionality — so the publish payload and
the artifact manifest cannot disagree about what a namespace is. Optional is the
ruled shape, not a convenience: the addendum's algorithm opens with
`if (namespace is absent) -> allow`, and a package that declares no namespace
makes no reservation and is not gated. A parity test judges both fields against
one table of values, so a change to either side fails.

**`objectstack package publish` sends it, read off the compiled artifact's
`manifest.namespace`** — the same place the command already reads
`manifest.id`. Three behaviours, matching the addendum's algorithm:

- namespace present → it travels on the `POST /cloud/packages` body as
  `namespace`, and is echoed in the publish summary;
- namespace absent → the key is omitted entirely (not `null`, not `''`), so
  "declares no namespace" never becomes a value the gate has to interpret;
- namespace malformed → the publish is refused before any network call, naming
  the rule and the fix.

The namespace is deliberately **not** overridable by a flag or by
`objectstack.manifest.json`, unlike `manifestId`: a reservation is only
meaningful if it names the object-name prefix the package actually ships, and a
second declaration surface would let a publisher reserve `foo` while installing
`bar_*` objects. For the same reason `TemplateManifestSchema` omits the field
rather than inheriting it.

Nothing about install-time behaviour changes. The in-process install gate,
`NamespaceConflictError`, the shareable `base`/`system`/`sys` set and the
`OS_METADATA_COLLISION=warn` downgrade are untouched, and the install path
acquires no network dependency.
