---
"@objectstack/spec": patch
"@objectstack/metadata-core": patch
---

The artifact-ingestion door no longer replays the **default-flip** class of ADR-0087 conversion, so an artifact carrying `defineApp({ hidden: true })` is registered with `hidden: true` — not as an unpublished app (#17885, #4829).

`app-hidden-to-unpublished` rewrites `app.hidden: true` into `app._unpublished: true`. Both keys are live and they mean opposite kinds of thing: `hidden` is navigation presentation and *"never an access gate"* (`ui/app.zod.ts`), while `_unpublished` is the machine-managed publish gate `filterAppForUser` drops the app on for every user without `studio.access` / `setup.access`. Measured before the change, on an artifact declaring `engines.protocol: ^17.0.0` — the range `create-objectstack` stamps — against a 17.4.0 runtime: the door emitted the `app-hidden-to-unpublished` notice and the object that reached registration carried `hidden: undefined`, `_unpublished: true`. So an author who asked for "keep this out of the App Switcher" got "nobody but a builder can see this" — the incident the `_unpublished` split was introduced to end, arriving through the conversion layer.

- **The entry is not withdrawn and no key moves.** It still fires where its precondition is a fact — the stored-row rehydration seams (a pre-split `hidden: true` row can only have come from the materialization path) and `os migrate meta`, where the operator asserts the source's age. What changed is that the artifact door, whose evidence is the artifact's **declared `engines.protocol` floor** rather than its age, no longer treats that guess as sufficient for a rewrite that reinterprets a live authorable key.
- **The retired window stays open.** Closing it wholesale would fix this and re-break #12772: an artifact built by 17.1.0 tooling carrying `allowRestore` / `allowPurge` would again be refused at the tombstone with no operator remedy. The door refuses one named class by id, with its reason written beside it, and the pin drives a retired conversion and a non-retired one through the same window to prove it.
- **New seam option, no new export.** `applyConversions` accepts `excludeConversionIds` — the seat-level spelling of "my evidence cannot carry this entry". `retiredFromLoadPath` cannot express it: that flag's jurisdiction is the authoring funnel and nothing else.
- ⛔ **The consumer is unchanged.** `filterAppForUser` withholding on `_unpublished` is correct; the defect was who writes `_unpublished`.

Deployments whose apps were being served as unpublished purely because of a permissive `engines.protocol` range will see those apps again, for every user, on the next boot. No artifact file changes and no stored row is rewritten.
