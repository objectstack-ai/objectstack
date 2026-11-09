---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Edit organization's Parent Organization and Sort Order help says they matter only where the deployment runs several organizations

Clause-②: no
Metadata-protocol: none

On a deployment with one organization, Edit organization still shows 上级组织 / Parent Organization and 排序 / Sort Order, and nothing told the administrator they do nothing there. Their help text, in the object declaration and in the `en` / `zh-CN` packs, now ends with "Meaningful only where the deployment runs several organizations." (「仅在部署运行多个组织时有意义。」). No field, permission or behaviour changes; the fields stay visible.
