---
"@objectstack/spec": major
---

`MetadataWatchEvent.type` now carries only the values the runtime emits: the enum narrows FROM `'add' | 'change' | 'unlink' | 'added' | 'changed' | 'deleted'` TO `'added' | 'changed' | 'deleted'` (#4536, follow-up to #4411).

The three raw chokidar values had zero producers: both emit sites normalize before constructing the event — `packages/metadata/src/node-metadata-manager.ts` translates chokidar's `add`/`change`/`unlink` in the watcher callbacks (`handleFileEvent` accepts only the canonical three), and `packages/metadata/src/metadata-manager.ts` normalizes repository ops (`create`/`update`/`delete` → `added`/`changed`/`deleted`). Consumers parsing events therefore never received the raw values, and no runtime behavior changes.

- FROM: an external implementor could construct events typed `'add'`/`'change'`/`'unlink'` and readers had to (needlessly) branch on six values.
- TO: an implementor constructing events with the raw values must emit `added`/`changed`/`deleted` instead; readers may delete any branches on `add`/`change`/`unlink` — they were unreachable.

No tombstone / ADR-0087 conversion: this is a runtime event envelope type, not authorable metadata — nothing parses it on a load path (the #4411 route).
