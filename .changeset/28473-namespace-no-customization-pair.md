---
'@objectstack/lint': patch
---

feat(lint): `os validate`, `os build` and `os lint` warn when a package's `manifest.namespace` is too long to have a paired customization namespace (`namespace-no-customization-pair`)

Clause-②: no
Metadata-protocol: none

ADR-0146 gives every installed base package one paired customization package, `<id>.custom`, whose namespace is the base namespace followed by `_custom`. A manifest namespace admits at most 20 characters, so a base namespace of 14 characters or more has no pair namespace: the ensure door refuses to create the pair, and the package's installers can never customize it. Until now its author learned this only when a customer first tried.

- **Now.** A new advisory rule reports such a package at `manifest.namespace` (or `packages[N].manifest.namespace` in a multi-package artifact) with severity `warning`, naming the namespace and the `_custom` pair namespace it cannot have. `os explain namespace-no-customization-pair` prints the reasoning.
- **One reader.** The verdict is `customizationNamespace` from `@objectstack/spec/kernel`, the function the ensure door creates the pair with, and the sentence is built from `MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH` and `CUSTOMIZATION_NAMESPACE_SUFFIX`. Nothing restates the limit.
- **Not judged.** A package that is itself a `.custom` pair (it is never paired again), a package that declares no namespace, and a namespace the manifest grammar refuses for another reason, which `os validate` reports.
- **Who sees it.** No shipped package or example in this repository: the longest namespace among them is `feature_flags`, 13 characters.

Nothing is refused: the rule never emits an error, and it does not run at the runtime publish door, because a package manifest is not a metadata item.

**The remedy.** Shorten `manifest.namespace` to 13 characters or fewer, and rename the object names it prefixes to match.
