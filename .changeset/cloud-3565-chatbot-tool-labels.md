---
'@object-ui/i18n': patch
---

feat(i18n): `chatbot.tool.create_record` / `update_record` / `remove_sample_data` labels and the record-write card's `console.ai.recordWrite*` labels in all ten packs; `chatbot.tool.draft_record` retired

Clause-②: no
Metadata-protocol: none

The spec registry now lists the cloud chat agents' confirmed record write and the sample-data cleanup (cloud#3565) and drops `draft_record`, so the chatbot's tool timeline gets a sentence for each new step in every pack ("Create the record" / "新建记录", "Change the record" / "修改记录", "Remove the sample data" / "清理示例数据") and loses the retired one, keeping `toolLabels-locale-parity-7481` and `toolLabels-sentences-12724` green. The console's record-write card gets its eleven labels under `console.ai.recordWrite*`: the create and update titles (with the object's label), the three buttons 确认 / 打开完整表单 / 取消, the two stored reasons, the "not included" lead-in and the three states (writing, written, cancelled) — plus `console.ai.sampleDataCleanupTitle`, the title of the 「清理示例数据」 card that lists the seeded tables and counts.
