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

Nothing else widens. `hooks[].object` and an app's own `navigation` `objectName` stay refused against the stack's own objects even when the name is listed, because ADR-0130 §1.5 records both refusals as the shape of the package seam.

The refusal moved rather than disappearing: in a composition of **two or more** packages, `composeStacks` now re-checks those two classes over the composed artifact, so a name `artifactObjects` claims and no package in the artifact defines is refused there, with the same `STACK_CROSS_REFERENCE_INVALID` code, the same `422`, and the same per-finding message. Only the header differs, naming the pass that refused it. `composeStacks` returns a single input untouched, so a one-package composition does not re-check the claim.

**What that changes about which inputs `composeStacks` accepts.** `defineStack` itself is unchanged for a stack that does not pass `artifactObjects` — every single-package app validates exactly as before. `composeStacks` is not: it applies the two artifact-scoped rules to **every** input carrying objects, not only the ones that opted in. For an input that passed the strict `defineStack` parse that is a no-op, so such an input cannot newly fail. For an input that **bypassed** the strict parse it is not: `defineStack(config, { strict: false })` returns before cross-reference validation runs, and a hand-built stack object never enters it, so these two rules have never been applied to it. Such an input carrying a dangling `permissions[].objects` key or `data[].object` is now refused at composition where it previously composed with only a warning. If you compose unparsed stacks, that is the one behavioural change to expect; a malformed `permissions` / `data` on such an input is still skipped with the existing non-array warning rather than raising.
