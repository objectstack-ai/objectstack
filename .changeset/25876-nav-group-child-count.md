---
'@object-ui/layout': patch
---

feat(layout): a collapsed sidebar navigation group shows how many entries it holds

Clause-②: no
Metadata-protocol: none

- **Before.** A closed navigation group drew its label and a chevron and nothing else, so a closed group holding one entry looked exactly like one holding ten, and users did not open it to find what was inside.
- **Now.** While a group is collapsed, `NavigationRenderer` draws a small count badge between its label and its chevron. The count is what opening the group would reveal: the entries that pass the same per-item guards the renderer applies (the `visible` expression, `requiredPermissions`, the `requiresObject` / `requiresService` capability gates, a `doc` entry's readability check, and an `action` entry only when the host wires `onAction`), counted through nested groups. Separators and the groups themselves are not entries. It is the same walk that decides whether a group renders at all (`hasVisibleNavigationItems`), so the count cannot disagree with the opened group.
- **When it does not show.** An open group shows no count, because its entries are in view. A group that holds the current route is forced open, so it never shows one. In the icon rail the badge is hidden under the same classes as the group label.
- **Accessibility.** The badge is `aria-hidden`: the disclosure's accessible name stays the group label, and the disclosure already announces collapsed or expanded.

What to do: nothing. No navigation key or value changes, and no translation key is added.
