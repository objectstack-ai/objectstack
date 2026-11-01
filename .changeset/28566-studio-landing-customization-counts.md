---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): each read-only base's card on the Studio landing says "n customized, m switched off"

Clause-②: yes (widening)
Metadata-protocol: none

Before an upgrade, or just to check, an administrator wants to see which installed apps they changed and what they switched off. Studio's landing now says it on each read-only base's card, for example "4 customized, 2 switched off" (zh 「已定制 4 项，已停用 2 项」).

- **The numbers are the server's.** Each card reads `GET /api/v1/packages/:id/customizations` once. "Customized" is the served overrides plus the served extensions of the base's `<base>.custom` pair, and "switched off" is the served switched-off count. The answer is judged by `GetPackageCustomizationsResponseSchema`. An answer that schema refuses counts as a failed read.
- **Zero only when the server answered.** While the read is pending, the line shows no number. A failed read shows a muted "Couldn't read customizations", with the server's sentence as its title, never "0".
- **Links.** When the package list holds the base's pair, "n customized" opens the pair in Studio (`/studio/<base>.custom/data`). "m switched off" opens the base's Automations pillar.
- **No line on a writable package or on a pair**, and a pair id is never sent: the route refuses one.
- **The landing paints first.** The counts arrive after it.
- **New strings.** `@object-ui/i18n`'s studio namespace gains seven `engine.studio.landing.customizations.*` keys in `en` and `zh`. The other languages fall back to `en`, as the whole namespace does. They interpolate `customized`, `switchedOff` and `pair`.
