---
"@objectstack/spec": minor
"@objectstack/cli": minor
"create-objectstack": minor
---

feat(spec)!: `manifest.id` enforces the reverse-domain rule its registry face already had (#17534)

<!-- adr-0087: registered manifest-id-reverse-domain-required -->

**BREAKING** in the accept-set sense, landing in the launch window as `minor`
(the repo's convention: `major` is refused by `check-changeset-no-major`, and
breaking-ness is carried by this banner plus the ADR-0087 disposition):
`ManifestSchema.id` was `z.string()` and accepted any string. It now enforces
reverse-domain notation — the same rule `PackageSchema.manifestId` has always
carried, now declared once and referenced from both sites so the two cannot
drift again.

Two declarations named one identity and disagreed. The registry enforced the
shape; the key an author actually writes did not. So a package scaffolded,
validated, built and booted with an id the publish path would refuse, and the
author met the rule for the first time at the most expensive possible moment.

FROM → TO, for metadata that used to parse and now fails:

```ts
// FROM — accepted by defineStack, refused at publish
defineStack({ manifest: { id: 'my_app',            /* … */ } });
defineStack({ manifest: { id: 'com.acme.my_app',   /* … */ } });

// TO — dot-separated lowercase segments; hyphens inside a segment, never underscores
defineStack({ manifest: { id: 'com.example.my-app', /* … */ } });
defineStack({ manifest: { id: 'com.acme.my-app',    /* … */ } });
```

The refusal carries the repair rather than restating the rule: it names the key,
echoes the value, shows both documented examples, and — having first checked the
candidate against the pattern itself — suggests `com.example.blank` for a bare
word and `com.dogfood.flow-fixture` for a value whose only fault is an
underscore. A suggestion it cannot verify it does not make.

⚠️ **Changing an id is a republish, not an edit.** An id is an identity: the
registry addresses a package by `manifest_id`, an installed row is keyed on it
and a dependent declares it. Before renaming, confirm nothing still addresses
the old value. That is why this ships as an ADR-0087 **semantic** entry
(`manifest-id-reverse-domain-required`) with a structured TODO and no automatic
rewrite — `objectstack migrate meta` will not rename an id for you.

`manifest.namespace` is unchanged and still admits underscores, so the two are
derived from a project name under different rules and neither is the other. Both
scaffolders were producing ids the new rule refuses and both now derive a
conforming one: the bundled `create-objectstack` template ships
`com.example.blank` and interpolates `com.example.<project-name>` in kebab form,
and `os init` derives its id from the project name instead of interpolating the
snake_case namespace (`os init my-app` produced `com.example.my_app`).
