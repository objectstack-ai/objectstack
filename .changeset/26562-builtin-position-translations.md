---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the seven built-in positions are served in Chinese, Japanese and Spanish

Clause-②: no
Metadata-protocol: none

Setup → Positions lists the platform's built-in positions (Platform Admin, Organization Owner, Organization Admin, Organization Member, Organization External Member, Everyone, Guest) beside the app's own. Under zh-CN the app's positions read in Chinese while these seven stayed English, because this plugin's translation bundle carried no `positions` group. The bundle now carries `positions.<name>.label` and `.description` for each built-in position in zh-CN, ja-JP and es-ES, the locales its permission-set translations cover, so `GET /api/v1/meta/position` serves them in the requested locale. English is unchanged, and nothing else of a position changes.
