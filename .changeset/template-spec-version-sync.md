---
"create-objectstack": patch
---

fix(create-objectstack): the blank template's `specVersion` stops shipping eleven majors stale, and the version-time sync covers every declared surface on every template (#9264)

The one bundled template declared the platform it targets in **two** places that
disagreed by eleven majors:

| file | key | was |
|:--|:--|:--|
| `objectstack.manifest.json` | `specVersion` | `^6.0.0` |
| `objectstack.config.ts` | `engines.protocol` | `^17` |

`scripts/sync-template-versions.mjs` re-stamped the config key and the template's
`@objectstack/*` dependency ranges, and **never opened the manifest at all**. So
`engines.protocol` tracked every major bump while `specVersion` sat at the value
it held when the script was written — and a green `sync-template-versions` run
was never evidence about it, because the script's failure mode was loud for the
keys it covered and mute for the key it did not.

**This is not confined to the registry contract.** `create-objectstack` copies
the manifest into every scaffolded project, rewriting `name`, `displayName` and
`namespace` and dropping `description` — it has never touched `specVersion`. So
every project scaffolded since v7 was stamped with a `^6.0.0` spec range while
installing `@objectstack/spec@^17.0.0`.

**The two keys are two facts, and the fix keeps them apart.** `engines.protocol`
is the ADR-0087 D1 runtime handshake range and carries the protocol major
(`^17`). `specVersion` is documented by `TemplateManifestSchema` as the
"Compatible `@objectstack/spec` semver range" and carries the package range
(`^17.0.0`) — the same value the script already writes into the template's own
`@objectstack/spec` dependency, so the manifest and the `package.json` now state
one fact once. They agree on the major only because the spec package's major and
the protocol major are kept in lockstep; they are stamped from two different
values.

Deleting the key was not available: `specVersion` is **required** by
`TemplateManifestSchema`, and every shipped manifest is parsed against it by
`check:template-manifests`.

**Two structural changes, because one-key-one-file coverage is what let this
sit:**

- the sync script's file list is now **discovered**, not hard-coded — templates
  are found by walking `src/templates/`, the same way `check-template-manifests`
  finds the manifests it parses, so a second template is covered on the day it
  lands;
- **every stamp is required**. A template whose file is missing, whose stamp is
  absent, or whose `package.json` declares no `@objectstack/*` dependency is a
  hard failure naming the path — never a skip. A skipped stamp is
  indistinguishable from a synced one in the log, which is the invisibility this
  fixes.

The manifest is rewritten as **text** rather than parsed and re-serialized:
`objectstack.manifest.json` keeps `scaffold.variables` compact on one line, and
`JSON.stringify(…, null, 2)` would reformat unrelated structure on every release.

CI coverage lands as four per-template ratchets in `template-consistency.test.ts`,
generalized off `blank` onto the same directory walk — including the invariant
that catches this exact class: the manifest's `specVersion` must equal the
`@objectstack/spec` range the template actually installs. Either file alone can
be self-consistently stale; only comparing them catches a stamp that covered one
and not the other.
