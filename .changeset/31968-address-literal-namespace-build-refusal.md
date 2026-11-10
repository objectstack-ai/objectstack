---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(cli, spec)!: `os validate` and `os build` refuse a namespace that spells an address literal, `defineStack` warns about it, and `os migrate stored-references` names an installed one.

Clause-②: no (narrowing) — `os validate` and `os build` refuse what they accepted before: a `manifest.namespace` (the stack's own, or a `packages[]` body's) equal to `actions`, `connectors`, `global`, `hooks`, `oauth` or `trigger`. `defineStack` still returns such a stack, with one warning. The upgrade report `os migrate stored-references` gains one section, `literalNamespaces` (a widening of a report's output, not of an accept set).
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` does not teach a namespace spelled like an address literal; the rule ships in the refusal text and in ADR-0150 D5.

<!-- adr-0087: not-required (no-migration-prescription) the refusal removes no key, export or field and changes the shape of no stored body; what an author does about a refused namespace is rename it, which no conversion can choose for them -->

**BREAKING** accept-set narrowing for ADR-0150 D5, at the author's build doors only: the router reads a literal segment of the address grammar before any namespace, so a package under one of these six namespaces never reaches its own qualified addresses. Measured first-party: 0 stacks, examples, fixtures or templates use one of the six.

- **Why.** The package install door already refuses such a namespace with the spec's judge (`validateNamespaceNotAddressLiteral`, `@objectstack/spec/kernel`); a new package was refused only when it was installed, never when it was validated or built.
- **Before.** `os validate` exited 0 and `os build` wrote the artifact for a stack under `namespace: 'hooks'`; `defineStack` returned it silently; the install door refused it later (`NAMESPACE_CONFLICT`, 422), while a package registered by the server's own boot was kept with one warning.
- **Now.** `os validate` and `os build` exit 1 with the judge's sentence, which names the literal and the doors that serve it, and `os build` writes no artifact. `defineStack` warns once per package and namespace with the same sentence and still returns the stack: it runs at every load of a config, the server's included (`os serve`, `os dev`, every host importing a stack), so a deployment that already holds such a package keeps booting after the upgrade. `os migrate stored-references` lists each installed package whose namespace is one of the six (`literalNamespaces`: its id, the namespace and the sentence), and the text face adds that its items are read with `?package=ID` and that a rename gives them qualified addresses.
- **Who moves.** An author whose stack (or a `packages[]` body) declares one of the six namespaces, at `os validate` / `os build`. **The one-line fix:** FROM `namespace: 'hooks'` TO any other namespace, e.g. `namespace: 'hooks_app'`, and its object names' prefix with it.
- **Unchanged.** `defineStack` throws nothing new; a namespace that only contains a literal (`triggers`, `globals`); the server's boot, which still keeps an already-installed package under such a namespace with one warning; the install door's refusal.
