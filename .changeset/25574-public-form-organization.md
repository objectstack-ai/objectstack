---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/metadata-core': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
---

feat(forms): a public form binds to the organizations it is published to (ADR-0138 D5)

A form's `sharing` gains `organizations`: the organizations the public form is published to, by organization slug. On a deployment with several organizations (one per legal entity, say), each organization publishes the same package's form on its own link, and a submission on that link lands in that organization, under that organization's own number sequences:

```ts
sharing: {
  enabled: true,
  allowAnonymous: true,
  publicLink: '/forms/supplier-registration',
  organizations: ['acme', 'globex'],
}
```

- The link names the organization: `GET /api/v1/forms/supplier-registration?organization=acme` and `POST /api/v1/forms/supplier-registration/submit?organization=acme`. The server reads the organization carrying that slug, as the system, and the submission is written in it and only in it.
- A link that names no organization, names one the form does not list, names a listed slug no organization carries, or repeats the parameter is answered exactly like an unpublished form: `404 FORM_NOT_FOUND` on both doors, nothing written. A bound form is never sent to the default organization or to the first one it lists.
- A bound form is offered on a walled tenancy posture (`group`, `isolated`), where an unbound form over a walled object is withheld: its submission carries the organization its link names. The administrator's read of the view and the save/publish advisory no longer warn about such a form.
- A form without `organizations` behaves as before (ADR-0138 D4): its submission lands in the deployment's one organization, and a link that names an organization is refused rather than ignored.
- `organizations` must be a non-empty list of non-empty slugs; `organization`, `orgs` and `tenants` are refused and pointed at it.
- New exports: `anonymousFormIntakeOrganizations` (`@objectstack/spec/ui`, re-exported by `@objectstack/metadata-core`) reads a form's binding; `resolvePublicFormOrganization` (`@objectstack/core`) is the doors' decision. `anonymousFormIntakeUnavailability` (`@objectstack/metadata-core`) takes the form's binding as an optional fourth argument; omitted, the form is judged unbound.

Clause-②: yes (widening)
Metadata-protocol: added
