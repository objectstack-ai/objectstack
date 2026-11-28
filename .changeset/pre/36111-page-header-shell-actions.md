---
'@object-ui/app-shell': patch
'@object-ui/components': patch
---

feat(console): reports and custom pages open with the console page header; the shell's top-right button group is built and placed, off while the top bar stands

Clause-②: yes (widening)
Metadata-protocol: none

- **Reports, the report index and custom pages draw the console page header** that lists and dashboards draw: the page's name (and description) on the left, its actions on the right. A report keeps its 「Edit」 (the inspector beside the report) as the header's action. A custom page's name and description move into the header; the page renderer no longer draws them a second time, and a `page:header` the author wrote stays as written, its title one heading level down (`h2`) so the page keeps one `h1`. An interface page swaps its own title row for the header, buttons included. On a phone a custom page keeps the face it had, its floating 「Edit in studio」 pencil included; from the phone breakpoint up the pencil is gone and the top bar's 「Edit app」 opens the same surface.
- **The top-right button group** (`ShellPageActions`, internal to `@object-ui/app-shell`): the comments slot, 「Edit app」 (words beside a non-pencil icon, icon-only below `lg`, the same gate and target as the top bar's pencil; a read-only package gets the eye), the AI assistant and help. The console page header draws it after its actions (so reports, dashboards and custom pages), the list page at the end of its view bar after ⋮, the record page in its navigation row before ✕. **It is off** while the top bar stands, so nothing changes on screen beyond the headers above; `localStorage['os:shell:page-actions'] = 'on'` turns it on for checking. The help menu is now one component the top bar and the group share.
- `@object-ui/components` exports `PageTitleHostContext`, a host switch (never metadata) that says the host draws the page's title and description: the page renderer then draws neither, and an authored titled `page:header` draws its title as an `h2`. Default `false`: every other host is unchanged.
