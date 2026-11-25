# objectstack#37197 — stage 1 design mockups: the docs portal in an app-less shell

Scratch design branch `claude/issue-37197-docs-shell-design`. **Nothing here is merged** and there is no pull
request. Stage 2 (the implementation) waits for the maintainer's approval of this design on #37197.

## How these were made

The screenshots come from the real console, not from a static page. The branch starts at PR #37193's head
(`claude/issue-37150-docs-in-app-shell`, fd2011e5). One prototype commit on top of it mounts the real `AppShell`
and `UnifiedSidebar` around `/docs…` from 768 px up:

- `ui/packages/app-shell/src/console/docs/DocsPortalShell.tsx` is the frame. It is `AppShell` with no top bar, and
  `UnifiedSidebar` in a new `docsPortal` mode, with the same command palette, docs-navigation slot
  (`sidebarDocsNavSlot`) and page-header button group as an app's docs pages. The navigation context stays `home`,
  no app is guessed, and the current app and last app are not written. A phone gets the current frame (Home's
  layout with the docs bar).
- `UnifiedSidebar` (`docsPortal`) keeps the head (collapse button, search, bell) and the foot (getting-started
  checklist, account). The first row is `SidebarDocsPortalMenu`, a neutral 「文档」 head, instead of
  `SidebarAppMenu`. The body is the docs slot.
- `PortalDocsNav` (console, `DocsNav.tsx`) is the sidebar body. 「全部文档」 comes first, then the title filter,
  then every book under its app's heading, grouped the way the index page groups them.

The stack was the showcase example on a fresh database, and the console was the Vite dev server of this branch.
The browser locale was `zh-CN` (console `zh-Hans`), so the labels read as the ruling words them: 「文档」 and
「全部文档」. The article text is the showcase's own English. Screenshots were taken with Playwright at
deviceScaleFactor 2. `capture.cjs` is the capture script.

## Views

Each line says how the view differs from the app shell of an app's docs pages (#37193). The reference shot is
`0-reference-app-docs-shell-37193-1440.png`: the same doc, under `/apps/com.example.showcase/docs/…`.

| # | File | What differs from an app's docs pages (#37193) |
|---|---|---|
| 0 | `0-reference-app-docs-shell-37193-1440.png` | The reference: the #37193 app shell at the same doc, for side-by-side comparison. |
| 1 | `1-desktop-docs-landing-1440.png` — `/docs` at 1440 px | The head is a neutral 「文档」 (book glyph) instead of the app's mark and name. There is no 「← 返回 APP」 row. 「全部文档」 is the first row and is highlighted, because it is the page on screen. The tree lists every app's books under the app's heading, not one app's books. Compared with today's portal, the top bar is gone. |
| 2 | `2-desktop-doc-open-1440.png` — `/docs/manual/showcase_tour_data` at 1440 px | The page body and the 「本页目录」 column are identical to #37193. Only the sidebar differs: the 「文档」 head, 「全部文档」 first (not highlighted), and the open book expanded in place inside the all-apps tree. The highlight is the console's default blue, where #37193 has the app's purple: no app branding is applied, because no app is current. |
| 3 | `3-desktop-docs-head-app-switcher-open-1440.png` — the 「文档」 head opened | It is the same dropdown as the app menu, under a 「你的应用」 caption. No row carries a check mark, because no app is current. 「添加应用」 stays. The two app-scoped rows (「设计布局」 and 「在 Studio 中编辑」) are left out. Choosing an app opens `/apps/APP`. The URL does not change while the menu is open. |
| 4 | `4-desktop-sidebar-collapsed-1440.png` — sidebar collapsed (head's collapse button) | The same as #37193 collapsed: the sidebar takes no width, the expand button sits at the page header's left, and the docs page keeps its full width. Nothing names the docs portal while it is collapsed. |
| 4b | `4b-desktop-sidebar-collapsed-floated-1440.png` — collapsed, pointer on the left edge | The same floated menu as #37193, with this variant's head and tree. |
| 5 | `5-phone-docs-landing-390-unchanged.png`, `5b-phone-doc-open-390-unchanged.png` — 390 px | **Unchanged**, the control: today's portal, with Home's bar (「/ 文档」, search, bell, avatar), the index cards, and the reader's in-page book disclosure. This is the same as #37193 on a phone, which also keeps its bar. |
| 6 | `6-tablet-docs-landing-768.png`, `6b-…-sidebar-open.png` — `/docs` at 768 px (optional) | Below 1280 px the sidebar starts collapsed, as every shell page does (`6`). Expanded (`6b`), it shows the 1440 px layout narrowed. There is no top bar at 768 px either. |

## Open design choices for the maintainer

1. **What the 「文档」 head shows while the sidebar is collapsed** (view 4). The design follows the app shell:
   nothing, only the expand button. An alternative is a small 「文档」 crumb beside the expand button.
2. **Where 「全部文档」 sits** (views 1 and 2). The design puts it as the first row of the sidebar body, as the
   ruling words it. The app shell (#37193) keeps it as a footer link under the tree. The two docs sidebars would
   then differ in this one row. The other option is to move it to the top in #37193 too, so both match.
3. **What the head menu holds** (view 3). The design has only the viewer's apps plus 「添加应用」. It has no Home
   row and none of the app-scoped rows. A 「首页」 row could be added if the portal should also lead back to Home.
4. **How the tree is grouped** (views 1 and 2). The design uses app headings, as the index page groups them, with
   every book folded except the one being read. The alternative is a flat list of books without headings.
5. **Branding.** The design uses the console's default accent (blue), because no app is current. The app shell uses
   the app's own colour.

Noted, not filed (an observation, carrier: stage 2): the sidebar tree shows a book's raw label ("Setup") where the
index card shows the localized label (「系统设置」). The two components read the label from different places. Stage 2
should use one source for both.
