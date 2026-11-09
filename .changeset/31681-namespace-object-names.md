---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/cli': minor
'@objectstack/metadata-protocol': minor
'@objectstack/metadata-core': minor
'@objectstack/runtime': minor
---

feat(objectql, cli, metadata-protocol, spec, runtime)!: a namespace never equals an object name, at every door that makes a namespace or an object live — and no object is short-named `custom` (`NS_custom`, the namespace the ADR-0146 paired package of `NS` takes).

Clause-②: no (narrowing) — `defineStack`, `os validate` / `os build`, the package door (`SchemaRegistry.installPackage`, and so `POST /api/v1/packages`), the Studio object doors (publish-mode save, per-item publish, `publishPackageDrafts`) and `POST /api/v1/packages/:id/publish` each refuse what they accepted before: a namespace equal to an object name in either direction, or an object `NS_custom`. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` does not teach a namespace spelled like an object name, or an object named `NS_custom`; the rule ships in the refusal text and in ADR-0150 D6.

<!-- adr-0087: not-required (no-migration-prescription) the refusal removes no key, export or field and changes the shape of no stored body; what an author does about a refused name is rename the namespace or the object, which no conversion can choose for them -->

**BREAKING** accept-set narrowing for ADR-0150 D6 (Q3 = A): the AI face spells `NS-NAME` and `OBJECT-ACTION`, so a namespace spelled like an object name made one address name two things. Measured first-party: 0 first-party namespaces equal an object name, and 0 objects are named `NS_custom`.

- **Why.** ADR-0150 D6 rules that a namespace never equals an object name. The spec's predicate (`findNamespaceObjectNameClashes`, `@objectstack/spec/kernel`) existed, and no door asked it.
- **Before.** A package of namespace `crm_lead` installed beside an object `crm_lead`, in either order; an object `crm_custom` installed and published under namespace `crm`.
- **Now.** Every door asks the one predicate and answers with its sentence, which names both spellings and both packages. `defineStack` and `os validate` / `os build` judge every namespace and object ONE artifact holds (its own manifest and top-level objects, and each `packages[]` body's); the package door judges the incoming package against every installed namespace and registered object (`NAMESPACE_CONFLICT`, 422, `clashes[]`); the Studio object doors and the package publish door judge each object about to go live against every installed package's namespace and its own `NS_custom` (`NAMESPACE_CONFLICT`, 422; the publish pre-flight's audit row spells it `namespace_conflict`). The draft's verdict tells the author the same sentence before any publish. A deployment that already holds such a pair no longer boots: the boot names both.
- **Who moves.** An author whose namespace equals an object name another package (or the same artifact) ships, or whose object is named `<namespace>_custom`. **The one-line fix: rename the namespace or the object.**
- **Unchanged.** An object whose name only STARTS with a namespace (`crm_lead_note` beside namespace `crm_lead`); `NS_custom_*` objects; a package's own objects under its own prefix; the same package registering again; a stack with no namespace; the namespace-prefix rule (`NAMESPACE_PREFIX`) and N's namespace name rule, which answer as before. `defineStack` and `os validate` / `os build` do not judge packages outside the artifact: a declared dependency carries an id and a range, never a namespace, so its namespace is not guessed — the install door judges it.
