---
"@objectstack/platform-objects": patch
---

The `action` metadata-form panel no longer prints English field names and tooltips to a Chinese, Japanese or Spanish author: six keys — twelve string leaves — were decided leaf by leaf and rendered in `zh-CN`, `ja-JP` and `es-ES` (#19403).

The five children of the `body` composite (`Language`, `Source`, `Capabilities`, `Timeout Ms`, `Memory Mb`) and the `Ai` exposure block read their English source in all three locales, `helpText` included. An en-echo is not automatically a defect, so each leaf carries a recorded reason in `action-body-panel-echo-decisions.test.ts` rather than a bulk rewrite — and four of the six keys had an **authored twin at the same schema key**: `hookForm` and `actionForm` declare the same composite over `HookBodySchema`, rendered on the hook panel and echoing here, byte-identical in `en`. `memoryMb` echoes on both panels, so that row records that it has no twin evidence and composes from the sibling key instead.

- **Machine tokens stay English, checked at the schema before a word was rendered.** `body.language.helpText` names `expression` and `js` — the two `z.literal` discriminators of `HookBodySchema`. `body.capabilities.helpText` names `api.read`, `api.write`, `crypto.uuid` and `log` — four of the five `HookBodyCapability` enum members. `ai.helpText` names `ai.exposed=true` and `ai.description`, the two canonical keys of `ActionAiSchema`, a `strictObject` that declares five aliases of `exposed`. Rendering any of them would tell an author in their own language to write a value the schema refuses. All kept, alongside `import`, `ctx` and the schema bounds `256` and `40`.
- **Values only.** No key was added or removed: each translated bundle changes 12 values, the full flattened key sets are identical on all four bundles (893 keys, 0 added, 0 removed), and `en` is untouched. Regenerated with `pnpm i18n:extract`, which dropped the 12 provenance rows per locale that recorded these leaves as unauthored extractor fills and added none.
- **The panel is now pinned by a derived population**, and a new cross-panel assertion holds the five shared `HookBodySchema` children to ONE rendering across both forms that declare them — a disagreement no single-panel pin can see, because it lives between two derivations.

Measured on the metadata-form catalogs: label keys echoing in all three locales fall **29 → 23** while the genuinely-translated control rises **509 → 515** (`zh-CN`) and **493 → 499** (`ja-JP`, `es-ES`), same population, same run.
