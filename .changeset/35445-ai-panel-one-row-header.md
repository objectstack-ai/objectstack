---
'@object-ui/app-shell': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(app-shell, plugin-chatbot): the AI panel in an app has one title row, and its composer reads cleanly

Clause-②: no
Metadata-protocol: none

The console's AI drawer title bar is one row: History, a 「···」 menu and a 「×」 Close. The menu holds the AI usage reading (with its upgrade or top-up entry when the pool runs low), Share, Expand / Restore side panel, and the Build Doctor. The Build Doctor is listed only for a user who may build (`manage_metadata`, the reading that already decides who gets the build composer). While the usage pool is running low or full, the 「···」 trigger carries a marker. The close button is the drawer 「×」, named Close, in both the side panel and the full window; closing still keeps the conversation for the next open. The phone sheet gets the same menu, without Expand.

The pane row under the title keeps the agent label and the app chip, but no longer draws Share or the Build Doctor in the drawer. `ChatPane` gains `actionsInHost` for a host that offers them itself. The full-page chat and the Studio copilot are unchanged.

In the composer:

- the 「正在看」 chip sits on the input's top edge, inside its frame;
- the closed model picker shows the model's label alone, truncated, with the full label on its title (no provider, no `×N`). The list rows keep both;
- the 「↵ 发送 · Shift+↵ 换行」 hint stays on one line;
- the 「+」 attachment button and its menu item are named "Add attachment" (「添加附件」).

An answer table's copy and download tools are named in the reader's language (「复制表格」, 「下载表格」 and their format variants) instead of streamdown's English defaults.

New locale keys, in every pack: `console.ai.dock.close`, `console.ai.dock.more`, `chatbot.composer.addAttachment`, `chatbot.answer.copyTable`, `copyTableAsMarkdown`, `copyTableAsCsv`, `copyTableAsTsv`, `downloadTable`, `downloadTableAsCsv`, `downloadTableAsMarkdown`. The drawer no longer reads `console.ai.dock.collapse`.
