---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): a flow just created in Studio reads 「已停用」 in its header, and the create toast says it is switched off

Clause-②: no
Metadata-protocol: none

Creating a flow in Studio publishes it at once, born switched off. The header's Status pill then read 「未发布草稿」 (Unpublished draft): it reads the engine's `/automation/_status` rows, and the create never asked for them again, so the snapshot taken before the flow existed had no row for it, which reads as never published. The create now re-reads the engine status after its publish, as Save and the on/off switch already do, so the header says 「已停用」 (Switched off) right after creation.

The create toast had reused the Save toast, 「已保存并生效：{items}」, which promises a run the new flow will not do. It now has its own key, `engine.studio.auto.createdOff`: 「已创建：{name}（已停用，启用后才会运行）」 / "Created: {name} (switched off; it runs once you switch it on)".

The Data pillar's first-object hint no longer ends 「…最后一次发布。」 ("publish once at the end"): objects are live on Save, and it now says each Save takes effect at once.
