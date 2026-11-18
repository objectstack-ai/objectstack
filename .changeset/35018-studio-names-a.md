---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): the permission page title, the AI panel's 正在看 line and the field panel header use names, not internal names

Clause-②: no
Metadata-protocol: none

Three Studio surfaces still showed internal names. They now use the names the builder gave:

- **Permission page.** The open permission set's title is the set's label alone. The app's name is already in the top bar, so the title no longer starts with it. The line under the title reads 随应用提供 / "Included with the app" instead of 包内置 / "Package". The note at the right of the tab row reads 本应用对象 · 发布后生效 / "This app’s objects · live on publish" instead of 仅本包对象 · 保存为草稿. The Setup pages keep their own wording.
- **AI panel 正在看 line.** On the Access and Automations rails the line reads the rail's word and the open item's label, for example 「正在看：权限 · 组织成员」 or 「正在看：流程 · 新会议提醒」, as the Data rail's 「正在看：会议 · 记录」 does. It no longer shows `permission · app_…_member_access`. The type and machine name stay on the line's hover title. What the agent receives is unchanged.
- **Field properties panel.** One header row: 字段属性 (Field properties), the field's label, the field's actions and one close button. The field's machine name shows only under 开发者信息 (Developer info). The 「AI 助手 / 回到对话 →」 strip at the foot of the right panel is gone, because the 属性 | AI 助手 switch at the top does the same thing and carries the same pending count.

`@object-ui/i18n`: three new `studio` namespace keys (`engine.studio.access.origin.app`, `engine.studio.copilot.subject.access`, `engine.studio.copilot.subject.flow`). The en and zh values of `engine.studio.access.banner`, `engine.studio.access.bannerPair` and their hover texts (`engine.studio.access.bannerTitle`, `bannerTitlePair`, `bannerTitleReadOnly`) are reworded: they say "app" where they said "package", and no longer name a 「Save」 button.
