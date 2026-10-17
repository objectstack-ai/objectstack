---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata-core': minor
---

fix(spec,objectql)!: an installed or stored page carrying a declaration spec 18 retires converts at load instead of stopping the kernel build — `isDefault` off a bound record page is deleted and `template: 'full-width'` re-spelled `default`, each with a named notice; the authoring, save and publish doors keep refusing

Clause-②: yes (widening)

**What changes.** Protocol 18 refused `isDefault: true` on a page that is not a record page bound to an object, and closed the page `template` set (retiring `full-width`), at every door — the page parse (`definePage`, `defineStack`, so `os validate` / `os build`, and the metadata save door) and the kernel's package registration (`SchemaRegistry.installPackage` / `registerItem`, `MisplacedDefaultPageError`). The registration refusal also fired when a kernel was built from a package that was installed BEFORE the retirement: every hosted environment holding such a package failed its kernel build, with no remedy short of upgrading the package in each one. Data at rest now converts, and only data at rest:

| Door | Before | Now |
| :--- | :--- | :--- |
| `definePage` / `defineStack` (`os validate`, `os build`), the metadata save door, package publish | refused at `isDefault` / `template` | **unchanged** — refused with the same sentence |
| a `sys_metadata` page row read back | served with `_diagnostics.valid: false` | converted on read: the flag deleted, `full-width` → `default`, `OS_METADATA_CONVERTED` notice |
| a compiled artifact inside the window its `engines.protocol` opens | the artifact door refused the artifact | converted before the strict parse, as every retired entry is |
| a package body registered through `manifest.register` / `ObjectQL.registerApp` that declares `engines.protocol` (an installed package, a marketplace install) | `MisplacedDefaultPageError`, kernel build stopped | converted before anything registers, with one `warn` per (package, conversion) naming the conversion id and the first site; the body is left unchanged on disk |
| the same body with NO declared range (a manifest a plugin builds in code), or declaring a floor newer than every retirement | refused | **unchanged** — refused |

**The two ADR-0087 D2 entries**, both `retiredFromLoadPath` from the day they land (the authoring funnel never replays them):

- `page-is-default-off-record-page-removed` (`page.isDefault`): deletes `isDefault: true` from exactly the pages `misplacedDefaultPageRefusal` refuses — a `home`, `app`, `utility` or `list` page, or a record page with no `object`. Lossless: nothing read the flag there (an app opens on its first navigation item). A default record page bound to an object keeps its flag.
- `page-template-full-width-to-default` (`page.template`): `'full-width'` → `'default'`. Lossless: the console drew both names with one template component. An unregistered template name (`centered`, `two-column`) and a region the template does not place have no lossless rewrite and are NOT converted — they stay with the parse, and the D3 entries `page-is-default-off-record-page-refused` / `page-template-closed-region-unplaced-refused` name the hand edits.

**`@objectstack/objectql`** — `ObjectQL.registerApp` (and the `manifest` service, for an artifact carrying `packages[]`) replays the versioned forward conversion (`applyArtifactForwardConversions`, `@objectstack/metadata-core`) over a package body that declares its protocol range, before `installPackage`; the converted copy is what the package record and every registered item carry. Public: `ObjectQL.convertPackageBodyForward(body)`.

**`@objectstack/metadata-core`** — `applyArtifactForwardConversions` reads the declared range off a FLAT package body (the manifest half beside its collections, no `manifest` key) when the definition carries no `manifest`; a definition with a `manifest` object is read there, as before.

Migration: none for authors — the authoring doors refuse exactly what they refused. An installed package converts again at every registration until it is rebuilt (`os build`) and re-published with tooling from a release that ships the retirement; the boot log's warn names the conversion and the site.

<!-- adr-0087: registered page-is-default-off-record-page-removed, page-template-full-width-to-default -->
