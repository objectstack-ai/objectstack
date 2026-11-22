# Evidence for objectstack-ai/objectstack#36292 (PR #36385) — never merged

Screenshots of the PR head 2c35661f, taken on a live CRM example app (`examples/app-crm`,
`objectstack dev --fresh`) and the Console dev server built from that head, Chromium,
1440x900 at deviceScaleFactor 2, UI language zh-CN, lead "Marie Curie".

- full-empty-set.png — full record page, 「显示 2 个空字段」 opened: 分配给 / 转化商机 read 「设置分配给」 / 「设置转化商机」.
- full-edit-after-click.png — the same page after one click on 「设置转化商机」: the inline edit session is open.
- preview-empty-set.png — the side preview (list + `?recordId=`), the same two placeholders.
- preview-edit-after-click.png — the side preview after one click on 「设置转化商机」.
- refusal-label-zh-CN.png — a status change new -> converted refused by the state machine; the save bar reads 「状态: …」 (translated).
