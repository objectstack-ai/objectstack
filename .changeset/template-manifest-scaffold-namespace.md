---
"@objectstack/spec": minor
---

feat(spec): declare `namespace` on `TemplateManifestSchema` as a scaffold-only extra (#6861)

`objectstack.manifest.json` carries a live `namespace` key that the schema
claiming to describe that file did not declare. The bundled blank template
ships `"namespace": "blank"`; `create-objectstack` rewrites the key in place
when it stamps a new project; and `readTemplateNamespace`
(`packages/create-objectstack/src/rewrite-identity.ts`) reads it back as the
fallback source for the template's original namespace when the tree carries no
`objectstack.config.ts` to read it from — the remote-template shape #4902
fixed. The getting-started guide has advertised the key on that file all along.

`TemplateManifestSchema` was silent about it, and silence here is not neutral:
the schema is a default strip-mode object, so anything validating the manifest
through it **dropped the key and answered success**, and a malformed value was
accepted rather than refused. That is the ADR-0049 enforce-or-remove shape, and
the key is genuinely live, so this is the ENFORCE leg — declare it, do not
remove it.

`namespace` is now declared on `TemplateManifestSchema`, optional, reusing
`CreatePackageRequestSchema.shape.namespace`'s value constraints so the scaffold
surface and the publish surface judge every namespace identically (ADR-0048
addendum §A.7, "two gates, one vocabulary"). Two consequences for anyone parsing
a template manifest: the key now **survives** the parse instead of being
stripped, and a malformed value is now **rejected** at the `namespace` path with
the shared coded message instead of passing green.

What deliberately did **not** change is the publish surface. The publish
payload's namespace is still read off the compiled artifact's
`manifest.namespace` (ADR-0048 addendum §A.2 Phase A1), never off this file,
because a reservation is only meaningful if it names the object-name prefix the
package really ships. The field is therefore re-declared rather than inherited:
the `.omit()` of the create-request field stays, and the scaffold field carries
its own describe saying in as many words that it is scaffold-only and not the
publish namespace. Collapsing the two into one inherited field would make the
on-disk descriptor a second way to reserve a namespace — the drift the addendum
rules out, and the reason #6760 omitted the key in the first place.
