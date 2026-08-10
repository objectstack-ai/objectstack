---
'@objectstack/service-settings': patch
---

Remove `step: 0.1` from the `ai.temperature` specifier (#6550). Since #6199 a declared `step` binds as a value constraint on both doors, and temperature's true domain is continuous on [0, 2]: the 0.1 grid refused legal values — `PUT /api/settings/ai` with `temperature: 0.15` was rejected and `OS_AI_TEMPERATURE=0.15` was loudly ignored. Both now work; `min: 0` / `max: 2` stay and keep binding (out-of-window values are still refused in the min/max vocabulary). #6199's grid machinery is untouched and still enforces any key that declares `step`.
