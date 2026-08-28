---
"@objectstack/objectql": patch
---

fix(objectql): correct `mergeObjectDefinitions`'s docblock to the real, closed merge set (#12680)

The docblock on `mergeObjectDefinitions` (`packages/objectql/src/registry.ts`)
said:

> Fields are merged additively. **Other props: later value wins.**

The implementation has never done the second half. It merges exactly:
`fields` (additively), `validations` (additively), `indexes` (additively),
and the three guarded scalars `label` / `pluralLabel` / `description`
(last-writer-wins, subject to the `tenantAuthored` yield rule). **Every
other top-level prop an `extend` contributor carries is silently
discarded** — `merged` starts as `{ ...base }` and nothing outside that list
is ever copied onto it.

This is a **docs-only correction plus a regression pin — zero runtime
behaviour changed.** `mergeObjectDefinitions` is not exported; nothing about
what it does was touched, only what the comment above it claims. Shipped as
`patch` rather than omitted because the file's behaviour is now backed by an
enforced pin (see below) where before it was backed by nothing but an
inaccurate comment — that is a real (if internal-only) improvement to the
package worth a version bump, and this repo's convention reserves "no
changeset" for changes with no user-facing effect of any kind, not for
"no runtime diff." There is no public API surface to widen or narrow (the
function is module-private), so there is nothing here for `check:*` gates
that watch exported shapes to see.

Why this matters: an author reading the old docblock and shipping an
`objectExtensions` entry carrying, say, `tenancy: { enabled: false }` would
have gotten a **silent no-op** on a security-relevant key — no error, no
warning, the base's existing value simply wins as if the extension had never
named the key. That near-miss is the reason this card exists (found while
resolving cloud#1653's investigation into exactly that override path). The
corrected docblock says the discard out loud; a new pin
(`registry-object-extension-nonenumerated-prop-discard.test.ts`) hands
`mergeObjectDefinitions` (via the public `SchemaRegistry` API) an `extend`
contributor carrying a non-enumerated top-level prop and asserts the merged
result does not carry it, with a guarded scalar as a positive control in the
same fold. `icon` is the pin's fixture — a real, spec-legal, security-neutral
top-level prop — deliberately **not** `tenancy`, so the pin does not read as
license to special-case that key elsewhere.

⛔ Out of scope, explicitly: implementing "later value wins" for the
undocumented remainder (making `tenancy` / `permissions` extender-writable is
a separate, much larger decision triage fenced off this card) and adding a
runtime warning on the silent drop (a real question, filed separately rather
than folded in here).
