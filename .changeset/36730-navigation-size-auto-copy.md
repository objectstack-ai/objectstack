---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-view': patch
'@object-ui/react': patch
---

fix: `navigation.size: 'auto'` reads, and opens, as the host's fixed default width in every locale and on every record drawer

Clause-②: no
Metadata-protocol: none

The Studio metadata form's help text for a view's `navigation.size` told authors in nine locales (ar, de, es-ES, fr, ja-JP, ko, pt-BR, ru, zh-Hant) that `'auto'` is derived from the object's field count and the viewport. It is not: `'auto'` keeps the host's fixed default width, the same for every object (the console's record side panel opens at 460px). Those nine leaves now say what en and zh-CN already say.

The record drawer of the bare data page (`/apps/:app/:object/data`) and of an interface list page opened at the overlay's own 42rem, not at that 460px default, and could not be dragged wider or narrower. Both now open as the object list's drawer does: at 460px, or at the width the reader last dragged in any side preview. An interface list page also takes its source view's `navigation.size` bucket, or its pixel `width`, which then wins over the shared dragged width.

Comments and TSDoc that described `'auto'` as the field-count derivation, paired the record flow's `size` with `FormView.modalSize`, or called the deprecated `navigation.width` a renderer fallback now say what the code does. The record flow's `size` is read only by the console's create / edit dialog, which passes `'full'` as its form dialog's `full` size (95vw from the `sm` breakpoint up; below it every size is a full-screen sheet) and never receives `'full'` today, since it derives with no viewport; the record drawer's width does not read it. An authored `width` still wins over `size`. No author action is needed.
