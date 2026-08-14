---
"@objectstack/plugin-security": patch
---

Correct `sys_position.name`'s translated help text in the `es-ES`, `ja-JP` and `zh-CN` bundles to say the machine name is unique **per organization**

The English bundle and the object source both already state that a position's machine name is unique per organization — the declared index is `{ fields: ['name'], unique: 'organization' }`. The three other shipped locales still asserted bare, unqualified uniqueness, so an admin reading Setup in Spanish, Japanese or Chinese was told the name had to be free installation-wide, which the declared index does not enforce. Each locale's leaf value now matches the source description, including its current examples (`sales_manager`, `hr_specialist` rather than the superseded `admin`, `editor`, `viewer`).

Leaf string values only — no bundle structure was hand-edited.
