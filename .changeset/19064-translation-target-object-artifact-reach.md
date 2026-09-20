---
"@objectstack/lint": patch
---

`translation-target-unknown` no longer reports the locale keys a package ships for an object a SIBLING package of the same artifact declares — the OBJECT rung's universe read `stack.objects` alone, while this rule's own docblock already declared the wider `artifactProvidedObjectNames` reach (#19064).

`os build` runs the rule table per PACKAGE as well as over the union (`compile.ts` step 3b-ii): each package body is judged as its own stack with the artifact's `packages[]` beside it as resolution context (`packageBodyAsStack`, #16611). On that leg `stack.objects` holds ONE package's objects, so a bundle key naming a sibling's object resolved against nothing. Measured on the probe stack (`examples/app-multi-package`'s shape — `core` owns `crm_account`, `orders` reads it and here also translates it), the key produced one `error` at `translations[0]["zh-CN"].objects.crm_account`:

> Translations are keyed to "crm_account", which no object in this stack defines. The resolver looks up keys derived from the metadata, so this whole subtree is dead weight — every label it carries renders untranslated.
>
> *Rename the key to the object it was written for, drop it, or ignore this if the object is contributed by another installed package. Defined objects: crm_order.*

That is the remedy that deletes a translation the runtime resolves, at `error`, so the run FAILED on it — and it is byte-identical, but for the name, to the finding a genuine typo produces. ADR-0130 makes the release artifact the co-ownership boundary, so the miss is the RUN's blind spot and not the author's mistake.

**The precedent is followed, not re-decided.** `validateObjectReferences` closed this exact shape on this exact carrier for object NAMES (#16611 — `artifactProvidedObjectNames` folded into its `resolvable` set). What differs here is the RETURN, and two pins hold it: this rule's universe is keyed by FACTS, not names, so the sibling's fields, options, views, sections and rules are folded WITH the name through the same collector the declaration loop uses. A name-only fold would resolve the object key and then judge the owner's own field keys against an empty fact set — the same false positive one level up — and a wholesale subtree skip (rung 2b's answer, for a target whose declaration is genuinely invisible) would leave the per-package leg unable to see a typo the union leg reports.

**The control, which is what makes this a narrowing and not a hole.** Widening a universe trades a false positive for a blind spot unless every genuine orphan still reports, so both directions are pinned side by side: the same package judged ALONE still errors (the context is what does the work); a name no entry of the artifact declares is still an `error` with its rule id, and the remedy now enumerates what the artifact provides; a field the sibling does not declare is still an `error` under the now-resolved object; one bundle carrying both a sibling key and a typo reports exactly the typo; an entry with no readable body (a segment reference) makes nothing addressable; and the single-`defineStack` shape is untouched, because `objects` is a stack collection with no `stack.manifest` form to read.

No schema moved, no export moved, and no accept set moved: this is a lint rule's false-positive set narrowing. `Clause-②: no`
