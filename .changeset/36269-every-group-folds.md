---
'@objectstack/spec': minor
'@object-ui/plugin-detail': minor
---

feat(plugin-detail): on the synthesized record page every titled field group folds, open by default

Clause-②: no
Metadata-protocol: semantic

On the synthesized (default) record page every field group that has a title now draws the right-hand chevron and folds from its whole title row, whatever its `collapse` says. This holds in the side preview, on the phone's 「详情」 tab, in the wide page's pinned left column and on the full page. Folding a group there is something the reader does. `collapse` still sets the first state: `'collapsed'` starts closed, `'none'` and `'expanded'` start open. 系统信息 still starts closed.

Unchanged:

- Forms and the designer preview: `'none'` still means always open, with no toggle.
- The untitled field bucket has no toggle.
- A print page draws every group open.
- An authored record page keeps its own faces.
- The fold state lasts while the record stays open. It is not saved.

`@objectstack/spec`: the `ObjectFieldGroupSchema.collapse` description, and the refusal guidance for a stray `expanded` key, now say that the default record page lets the reader fold every titled group. The enum, its default and what it accepts are unchanged.

What to check in an app: an object that used `collapse: 'none'` to keep a group's heading from folding on the record page now shows a chevron there. The setting still keeps the group always open on forms.
