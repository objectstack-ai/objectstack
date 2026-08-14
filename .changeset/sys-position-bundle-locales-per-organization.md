---
"@objectstack/plugin-security": patch
---

Correct `sys_position`'s translated uniqueness text in the `es-ES`, `ja-JP` and `zh-CN` bundles to say the machine name is unique **per organization**

The English bundle and the object source both already state that a position's machine name is unique per organization — the declared index is `{ fields: ['name'], unique: 'organization' }`. The three other shipped locales still asserted bare, unqualified uniqueness, so an admin reading Setup in Spanish, Japanese or Chinese was told the name had to be free installation-wide, which the declared index does not enforce.

Both places `sys_position` states the rule are corrected:

- `fields.name.help`, the field help in the object's detail and edit views. It now also carries the source's current examples (`sales_manager`, `hr_specialist` rather than the superseded `admin`, `editor`, `viewer`).
- `actions.clone_position.params.name.helpText`, the help on the Clone Position dialog's API-name input — the text an admin reads at the moment they type a new name.

Leaf string values only — no bundle structure was hand-edited.
