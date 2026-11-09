---
'@objectstack/cli': patch
---

fix(cli): `os lint`'s `naming/namespace-prefix` warns on every bare package-authored metadata name, and no longer calls the prefix optional

Clause-②: no
Metadata-protocol: none

Every metadata name a package authors now carries its namespace, the way object names already do: two installed packages that share a bare name such as `send_email` often resolve to only one of them, silently. `os lint` says so for every metadata type a stack can declare (flows, actions, hooks, picklists, pages, dashboards, reports, datasets, apps, email templates, webhooks, connectors, permission sets, agents, tools, skills, jobs and the rest), with the rename as the finding's `fix`:

```text
⚠ Flow "onboard" does not carry the package namespace "crm". … rename it to "crm_onboard" …
```

It stays a warning: nothing is refused, and `os lint --strict` is the only way it fails a run.

Not judged, because the name is judged elsewhere or derived from another item: objects (`defineStack` already refuses a bare object name), views (named for their object), docs (the doc lint's `docs/namespace-prefix`), object and picklist extensions, fields, translation bundles, `functions`, and an item that declares `overrides` (it must keep the base package's name). A name that is the namespace itself, starts with `sys_`, or starts with `<namespace>.` (the dotted capability shape, `billing.refund`) carries it already. A package that declares no `manifest.namespace` is not judged.

`os generate` writes the names it scaffolds the same way. In a project that declares a namespace, `os g flow onboard` now writes `crm_onboard_flow`, and the same goes for actions, dashboards, apps, skills, picklists, permission sets and datasets. Before, only object names got the prefix, so a fresh scaffold drew this warning on its first lint. A name that already carries the namespace is not prefixed twice.

The intra-package duplicate warning stays under the same rule id, for a prefixed name declared twice as well. It no longer suggests the prefixed spelling as its rename (the new finding carries that) and no longer ends with the sentence saying the prefix is an optional convention.
