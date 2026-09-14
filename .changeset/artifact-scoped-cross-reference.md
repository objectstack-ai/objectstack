---
'@objectstack/spec': minor
---

`defineStack`: a package of a multi-package release artifact can now grant permissions on, and seed data into, an object one of its SIBLING packages owns.

**FROM** — every `permissions[].objects` key and every `data[].object` had to name an object the same stack declares. In an ADR-0130 artifact this made two accepted records contradict each other: the 2026-09-02 addendum keeps every permission set whole in the `type: app` package, so as soon as that package also owns objects of its own, its sets were refused for granting on its modules' objects (`Permission 'sales_rep' grants on object 'crm_case' which is not defined in objects.`). The only escapes were `strict: false` for the whole package or splitting the sets per package, which contradicts the addendum.

**TO** — pass the artifact's other object names to `defineStack` and those two reference classes resolve against the artifact instead of the one stack:

```ts
const service = defineStack(serviceConfig);                // owns crm_case
const app = defineStack(appConfig, {                       // owns crm_account, grants on crm_case
  artifactObjects: service.objects?.map((o) => o.name),
});
export default composeStacks([service, app], { manifest: 'preserve' });
```

Nothing else widens. `hooks[].object` and an app's own `navigation` `objectName` stay refused against the stack's own objects even when the name is listed, because ADR-0130 §1.5 records both refusals as the shape of the package seam. A stack that does not pass `artifactObjects` — every single-package app — validates exactly as before.

The refusal moved rather than disappearing: `composeStacks` now re-checks those two classes over the composed artifact, so a name `artifactObjects` claims and no package in the artifact defines is refused there, with the same `STACK_CROSS_REFERENCE_INVALID` code, the same `422`, and the same per-finding message. Only the header differs, naming the pass that refused it.
