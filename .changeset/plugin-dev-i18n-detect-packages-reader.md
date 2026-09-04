---
"@objectstack/plugin-dev": patch
---

fix(plugin-dev): the i18n auto-detect resolves `translations` from `packages[]`, not only the flattened top level (#15232)

`DevPlugin.init`'s 3b block read `options.stack.translations` and nothing else.
For a multi-package app under the ADR-0130 D4 option-B shape — where
`packages[]` carries each definition exactly once and the flattened top-level
copy is gone — that read returns `undefined`, the detection concludes "this app
declared no copy", and the boot continues. Nothing throws and nothing logs.

What the developer gets instead is the wrong strings. `I18nServicePlugin`
(`@objectstack/service-i18n`) is never registered, so the `i18n` slot keeps the
core in-memory fallback: `os dev` serves message KEYS, or last release's copy,
for an app that declared real translations. It reads as "the translations are
broken", not as "a collection went missing", which is why it is a reader fix
rather than a footnote.

The detection now reads the flattened top level FIRST and then each package
body, in the order `resolveArtifactPackageOrder` (`@objectstack/core`,
ADR-0130 D4+D5) registers them:

- **Every artifact the platform emits today answers bit-identically.** The
  flattened level still answers first and short-circuits, so the `packages[]`
  pass can only supply a declaration the top level did not have. This is the
  reader half of the ruled order (readers first, emitter last, the artifact
  additive throughout), so it lands with no change to what any command emits.
- **The caller's original expression is preserved, not re-expressed.**
  `Array.isArray(t) && t.length > 0` still decides the top level, per package
  body as well — re-expressing a gate as a resolved-and-counted traversal is
  what silently changes the verdict for a stack that declares the key empty.
- **⛔ `stack.packages` is not iterated directly.**
  `resolveArtifactPackageOrder` is the platform's one traversal and also the
  GATE that parses each entry, so a second traversal would disagree with the
  load path about which artifacts are loadable. An artifact with no `packages`
  key is left entirely on the old path — the key's absence is checked before
  the call, because D4's second branch would otherwise hand the caller's own
  object back and read the same `translations` twice.
- **A malformed `packages` is refused, not skipped.** A non-array `packages`,
  an entry inlined instead of wrapped under `manifest:`, or a duplicate package
  id raises the same ADR-0112 envelope (`code` + `status: 422`) that
  `ObjectQL.registerApp` raises for the same object later in the same boot.

The decision — detection plus the locales it derives — is now one exported
function, `devI18nPluginOptions`, so the #15004 option-B acceptance pin
measures it by CALLING it rather than re-implementing the read. `DevPlugin`
keeps the dynamic import and its degradation: those are about the optional
package being installed, which is a different question from what the stack
declares.
