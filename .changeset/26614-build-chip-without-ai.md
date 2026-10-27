---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell,i18n): on a deployment with no AI agent, Home's build chip opens Studio's new-package flow as "New in Studio", and `/ai` says no assistant is enabled instead of redirecting home

Clause-②: yes
Metadata-protocol: none

- **Home's build chip reads the agent catalog.** On a deployment whose catalog (`GET /api/v1/ai/agents`) is empty or absent, the greeting row's "Build an app" (「构建应用」) promised a build nothing there could start. There it now reads "New in Studio" (「在 Studio 中新建」) and opens Studio's new-package flow; a session that may not author gets no build chip at all, while "Start with a template" keeps the reason. The chip waits for the catalog's answer, so neither form flashes first. With an agent in the catalog nothing changes.
- **`/ai` with no agent.** `RequireAiSurface` used to redirect a visit to `/ai` home with no word of why. It now shows the AI-unavailable screen in place (「AI 助手不可用」 · 「当前部署未启用 AI 助手。其他功能一切正常。」), with the way home and, for an admin who may author on a runtime that offers authoring, the same "New in Studio" link. The screen is the one `AiChatPage` already showed for an empty catalog, now its own module (`console/ai/AiUnavailable.tsx`) shared by both. `RequireAiSurface`'s `redirectTo` prop keeps its name and now sets where that screen's way home leads.
- **Studio deep link.** `/studio?new=package` opens the Studio landing with the create-package dialog open, and drops the param from the address. `STUDIO_NEW_PACKAGE_PATH` (`views/studio-design/studioNewPackage.ts`) is its one spelling.
- **i18n.** New key `home.build.inStudio` in all ten packs.
