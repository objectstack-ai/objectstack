# app-multi-package — one artifact, two packages

The producer-side fixture for [ADR-0130](../../docs/adr/0130-release-artifact-as-co-ownership-boundary.md)
D4: a project whose release artifact carries **two** packages that share one
namespace, so the product splits into modules without renaming a single object.

| package | type | namespace | owns |
| --- | --- | --- | --- |
| `com.example.multi.core` | `app` | `crm` | `crm_account`, the `multi_crm` app |
| `com.example.multi.orders` | `module` | `crm` | `crm_order` (lookup → `crm_account`) |

```bash
pnpm --filter @objectstack/example-multi-package build   # → dist/objectstack.json with packages[]
pnpm --filter @objectstack/example-multi-package dev     # boots the same shape from source
```

The artifact's `packages[]` is what `ObjectQL.registerApp` iterates — each entry
is one package ASSEMBLED (manifest fields plus the collections that package
owns), declared by `AssembledPackageBodySchema`. `GET /api/v1/packages` on a
booted instance lists both rows.

`orders` carries **no `scope` key** on purpose; the App's navigation lives with
the App package because a package's own navigation may not point at a foreign
object, while cross-package lookups (which `crm_order.account` is) are accepted.
