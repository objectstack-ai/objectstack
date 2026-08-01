---
'@objectstack/spec': minor
---

The view surface closes — the container, both view kinds, and the ~28 config shapes under them. This is the last batch of #4001.

Views are the surface an author iterates on visually, which is exactly why a dropped key hides here: the view still renders, just not the way it was described. `FormFieldBaseSchema`, `FormSectionSchema` and `FormButtonConfigSchema` were closed years ago under ADR-0089 D3a; the other forty-odd shapes in the file kept the posture those three were rescued from.

**`defineView`'s guard was another one-door workaround.** It rejects a container that defines no views, and its comment says why: "`ViewSchema` strips unknown top-level keys, so a *flat* list view would parse to an empty container". That is the fifth bespoke guard this campaign has found built around silent stripping, and like all of them it covered exactly one door — `defineView`. Through the metadata door (Studio, the API, an agent) a flat view produced an empty container in silence. The rejection now lives in the parse, so it reaches both, and carries the wrap instruction rather than only the symptom. The guard stays for the case strict cannot see: `defineView({})`, which has no unknown keys and still registers nothing.

**The container carries its own identity and object binding, and the first draft tombstoned all three.** `name`, `label` and `object` were in that guidance list, telling authors they "belong to a single VIEW, not to the container" — which rejected shapes the platform itself writes: `saveMetaItem` sends the name, artifact-shipped containers (`service-ai/ai_traces`) carry it, the validation sweep injects it, and a stack-level `views: [...]` entry needs `object` to say which object its views belong to (`getViewsByObject()` reads that binding). All three are now declared — `object` as live with its consumer cited, `name`/`label` as dead *body* keys with the row column live, exactly as `translation` needed in batch 5.

Caught by the full monorepo suite — `@objectstack/objectql`, then `@objectstack/cli` — never by `packages/spec`. That is the fourth false guidance claim in three batches (`action.permissions`, `action.location`, `view.name`/`label`, `view.object`), and the fix that finally worked was not more care but a different method: **scan every real container payload in the repo and keep only the guidance entries no real payload contradicts.** Six of the nine survived. That check costs one command and should have run before the guidance, not after three CI failures.

The rule worth carrying: **a rejection's prose is behaviour, not documentation.** It tells an author what to do next, and a confidently wrong one is worse than none, because there is no reason to doubt it.

**Three shapes are deliberately left open, each with its reason in the file rather than a silent skip:**

- **`FormSectionSchema`** already closed under ADR-0089 D3a with `strictVisibilityError` and a `.transform()` that normalizes the `visibleWhen`/`visibility` pair. Converting means re-expressing that map as `guidance` and re-proving the transform — a refactor of working, tested behaviour, not a strictness change.
- **`UserFiltersSchema`** deliberately *strips* `tabs`/`showAllRecords`, which are page-only keys (ADR-0047), with a test asserting the drop. The likely right end state is a rejection saying "tabs are page-only" — but that is a behaviour change with a real consumer question behind it (something may pass a page-shaped block through relying on the strip to narrow it). The campaign's own rule is verify-then-enforce, and this batch did not verify it. Named as the one open shape in the file.
- **The flattened Studio overlay** in `ViewMetadataSchema` must stay open: it carries auxiliary round-trip keys (`isPinned`, `sortOrder`, …) that `saveMetaItem` persists verbatim.

**That last one is the trap the ledger warned about, arriving on schedule.** `.extend()` inherits strictness, so closing `ListViewSchema`/`FormViewSchema` for authoring silently made the overlay strict too — turning a shape *the platform itself writes* into a 422. Both members now `.strip()` back, with a comment saying the `.strip()` is load-bearing rather than leftover.

## `view` is the end state, not the last item of debt

The registered `view` schema stays `strip`, and it always will: it is a union of three runtime shapes and a union is only as closed as its most open member. That member is the Studio overlay above — a wire shape wearing the same type name.

So the campaign's final number is **24 of 25 registered types closed, with the 25th a documented permanent exception**. That is recorded in `metadata-type-schemas.test.ts` beside the reverse pin, so nobody "finishes the job" by force. What closed is everything an author writes; what stayed open is the thing the ledger's classification rule exists to distinguish — arriving here as the campaign's answer rather than as an exception to it.

## Where the campaign ends up

- **Registered types closed: 24 of 25** (from 9 when this line started), the last one exempt with a stated reason.
- **The ADR-0010 undeclared-envelope debt list is empty**, from the eight the structural walk opened it with.
- **The unknown-key warning layer has one covered root left** — `view`, and only its open member. When a layer built to warn about strip-mode metadata has almost nothing left to warn about, that is the ratchet finishing.

Authoring impact: a key none of these shapes declares is now rejected instead of silently discarded — it was already being ignored, so no working view changes.
