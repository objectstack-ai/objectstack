---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(app-shell): the field-permission editor shows and writes exactly what the runtime enforces for a field with no explicit rule

Clause-②: no
Metadata-protocol: none

- **A field row without a rule.** In the permission-set editor (Studio Access, and the permission sets under Setup), a field the set declares no field rule for is not constrained by the set: the object grant decides. Its row now shows the object row's own Read and Edit, in grey with a dashed edge, and says it follows the object. A field rule shows its own Read and Edit in the usual colour. A rule that grants Read or Edit the object row does not is ringed in amber, and its tooltip says that a holder of this set alone cannot use it.
- **Every control writes only what changes on screen.** A click on a row without a rule changes only the box it lands on. The field shortcuts move each visible row to their target and leave a row that already shows it as it is: **Read-only all** (renamed from **Read all**, since it switches Edit off), **Write all**, and **Clear**, which returns the visible rows to the object grant. Adding a row condition (**When (edit)**) to a row without a rule changes no box.
- **The permission-set preview** (also shown for each permission set under a position) lists every field rule the set declares, tagged hidden, read-only or editable.
- **`@object-ui/i18n`:** in the `studio` namespace, `perm.field.bulk.readable` reads "Read-only all" (「全部只读」), and four new keys explain the grey and amber boxes: `perm.field.inherited.legend`, `perm.field.inherited.tip`, `perm.field.capped.read` and `perm.field.capped.edit`. The preview's `engine.permissionPreview.fls.readOnly` row is new in `@object-ui/app-shell`.

What to do: open the field rows of the permission sets you maintain and check them against what you intend. Coloured boxes are rules the set declares; grey boxes follow the object. **Clear** on a row returns it to the object grant.
