---
"@objectstack/console": minor
---

Console (objectui) refreshed to `7d9734d5e321`. Frontend changes in this range:

- feat(core): say which column identity key won, out loud (#3104 PR3) (#3124)
- fix(detail): Attachments become a peer tab with a live count badge, and their copy is translated (objectstack#4358) (#3123)
- fix(console,app-shell): readable reassign hand-off + "System" label for svc:* audit actors (objectstack#4365, objectstack#4366) (#3121)
- fix(fields): lookup multi-value hydration batches via $in and shows loading instead of the empty placeholder (#3108) (#3120)
- fix(list,grid,detail,tree,core): every column resolver reads one key (#3104 PR2) (#3122)
- fix(core,list): 列身份归一到 ingestion chokepoint — 一列一个身份 (#3104 PR1) (#3119)
- fix(detail): a related list has one sorting semantics instead of two (#3106) (#3113)
- feat(components,grid,list): a column-header sort orders the whole list, not the page you can see (#3106) (#3112)
- fix(data-objectstack): a string `$orderby` reaches the server as a sort, not a list of character indices (#3106) (#3109)
- fix(types,core): the `*Validation` five derive from spec 17, and the engine stops disagreeing with the server (#3103) (#3107)
- fix(app-shell): lookup-param helpText only renders when the param actually degraded to a raw-id input (#3094) (#3095)
- fix(form): numeric/boolean option values survive selection typed (#3090 PR3b) (#3100)
- fix(list,detail): sorting a lookup column stops ordering by an invisible key (#3096) (#3102)
- feat(flow-designer): the script node's form authors what the executor runs (framework#4278) (#3099)
- fix(form): declare the runtime field metadata slot, ban the spec FormField misimport (#3090 PR3a) (#3097)
- fix(console): LocalizationFetchProvider retries a transient /me/localization failure (#3098)
- fix(app-shell,i18n): drop the developer-voiced default form subtitle (#3093)
- fix(form): spec-vocabulary fields stop crashing the standalone form; every surface names the boundary (#3090) (#3092)
- fix(form): harden the spec↔runtime form-field chokepoint, derive SelectOption, complete FormFieldSchema (#3090) (#3091)
- fix(types,layout): navigation metadata stops losing the spec fields the renderer already honours (objectstack#4115) (#3088)

objectui range: `bebaebd39ace...7d9734d5e321`
