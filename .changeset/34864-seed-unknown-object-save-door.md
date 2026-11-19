---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol): the save door refuses a seed whose object does not exist, and the publish probe names a missing object instead of asking to publish again

Clause-②: no (narrowing)
Metadata-protocol: narrowed

**The save door refuses a seed bound to an unknown object.** `saveMetaItem` (the `PUT /api/v1/meta/seed/:name` door, the MCP draft save and every other caller) now answers `422 INVALID_METADATA` for a `seed` whose `object` no package registers and no stored or code-defined object carries, with one finding at `object` that names the seed, the object and the fix. Before this, such a seed was stored 200; its publish answered `published` while the load wrote nothing.

- A draft save also accepts an object that is itself only a draft (it is judged at the seed's publish, as before). A live save needs the object published.
- An object of a dependency package, or any object the registry serves, is accepted as before.
- Unchanged: the publish promotion and the restore doors do not refuse such a seed (the load reports it, and a publish keeps going), and a `migrate-stored` re-save is not judged.

Fix for a refused save: correct `object` to the object's full name (for example `crm_lead`, not `lead`), or create the object first, as a draft for a draft seed or published for a live one.

**The publish probe names a missing object.** When a published seed's object does not exist, the `seed_not_applied` finding now says so: `message` and `fix` name the missing object, and the person's sentence (`userMessage`, cause `missing`, in every platform locale) tells them to correct the object or create and publish it. A read that fails on an object that does exist still asks to publish again (cause `unreadable`).

<!-- adr-0087: not-required (no-migration-prescription) no key, value or type is retired: a seed naming an object that does not exist was never loadable, and the refusal carries its own fix -->
