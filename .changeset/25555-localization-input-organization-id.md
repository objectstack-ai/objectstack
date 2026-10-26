---
'@objectstack/core': patch
'@objectstack/mcp': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-hono-server': patch
---

refactor(core)!: `resolveLocalizationContext` takes the organization as `organizationId`; the `tenantId` key is retired

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/core#ResolveLocalizationInput.tenantId) the retired member is a key of a published runtime TypeScript input with no Zod schema, no spec declaration and no stored shape; the compiler reports it at every object-literal call that still spells it, and nothing exists for `objectstack migrate meta` to rewrite -->

**BREAKING** for a TypeScript caller of `resolveLocalizationContext` from `@objectstack/core`. The key that names the organization to localize for is renamed. There is no alias and no deprecation window.

`ResolveLocalizationInput.tenantId` always meant the **organization** id: the settings service stores and reads `localization` under the organization (ADR-0131 D8), and the direct `sys_setting` fallback reads that organization's rows. The name did not say so, and an environment id passed there type-checked. It matched no organization's settings, so every non-UTC organization silently resolved its timezone as `UTC`, and the date boundaries cut from it moved with it. The key is now `organizationId`, and the resolver reads no other spelling at run time.

- FROM `ResolveLocalizationInput.tenantId` TO `ResolveLocalizationInput.organizationId`: pass the caller's organization id under the new key, `resolveLocalizationContext({ ql, settings, organizationId, userId })`. Never pass an environment id.

**Who moves.** A caller that builds the input as an object literal with `tenantId` gets a compile error (excess property) and makes the one-key fix above. A caller that builds it some other way, such as spreading an object that holds `tenantId` or passing a variable typed wider than the input, does not get that error: its `tenantId` is ignored and the resolver localizes as for a caller with no organization, so grep for `tenantId` beside `resolveLocalizationContext`. In this repository the four callers (`@objectstack/core`'s request execution context, `@objectstack/mcp`, `@objectstack/plugin-audit` and `@objectstack/plugin-hono-server`) are migrated here and behave as before.

**Not moved.** The settings service's own scope argument, `{ tenantId, userId }` on `get` / `getMany`, keeps its spelling. It is a separate surface with its own callers. The resolver passes the organization id there as before.
