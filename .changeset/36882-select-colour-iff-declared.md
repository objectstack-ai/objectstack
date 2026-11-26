---
'@object-ui/fields': minor
'@object-ui/plugin-calendar': minor
'@object-ui/plugin-gantt': minor
'@objectstack/spec': patch
---

feat(fields,plugins): a select option is coloured only when its author declared a colour

Clause-②: no
Metadata-protocol: semantic

**Reach: every app's select options that declare no `color` now render neutral.** Until now an option with no declared colour was still drawn in colour: the renderer looked its value up in a built-in table of English and Chinese words (`won` green, `open` blue, `已联系` blue, ...), and when that missed it hashed the value onto an eight-colour palette. The colour looked meaningful and was not, and could say the opposite of the value. Now a colour on a badge means exactly one thing: the author declared it.

- **Badges, dots and chips** (grid cells and group rows, kanban cards, the filter value panel): an option with no declared `color` renders the neutral badge (`bg-muted text-muted-foreground border-border`, theme-aware in light and dark) or the gray dot. Declared colours, family names and hex, render exactly as before.
- **`getBadgeColorClasses(color)`** answers the declared family or the neutral badge; **`getSemanticColorName(color)`** answers the declared family or `undefined`. Both keep their second parameter so existing callers compile, and neither reads it.
- **Gantt `colorField`**: the bar takes the field's declared option colour (a declared palette family such as `blue` paints that family's palette hex, the colour its badge shows), else the value when it already is a colour literal (hex, `rgb()`, `hsl()`), else the default bar colour. No colour is derived from the value any more (a palette name such as `red` stored as the value included), and the record's `status` / `state` / `priority` / `severity` no longer colours a bar.
- **Calendar**: an event takes its declared colour (a palette family declared on the option now paints that family's tint), a hex or a Tailwind utility as before; any other value, a palette family name stored as a record value included, paints the default event colour instead of a hashed one.
- **`@objectstack/spec`**: the `colorField` descriptions of the calendar and gantt configs say so.
- **A declared colour outside the nine palette families and not a hex** (for example `teal` or `amber`) is accepted by the schema but renders neutral, as no declaration: before, the value hash coloured it. Declare one of `gray`, `red`, `orange`, `yellow`, `green`, `blue`, `indigo`, `purple`, `pink` or a hex instead; a warning for these spellings is tracked in #37435.

**To keep a colour, declare it on the option**: `{ label: 'Won', value: 'won', color: 'green' }`. There is no switch that brings automatic colouring back. The platform's own objects declare the colours they rendered with (`sys_notification.severity` and the rest), so their badges do not change.
