---
'@objectstack/runtime': patch
---

fix(runtime): the clone door's notice names the clone's own off-switch, its status (#20726)

`POST /api/v1/automation/:name/clone` answers a `notice` saying the clone is armed. It told the admin to switch the clone off through `POST /api/v1/automation/NAME/toggle`. A clone carries no package envelope, so it is a flow authored in the deployment, and that switch refuses it: the switch turns packaged flows on and off only. The notice now names the clone's own switch: send its complete definition with `status: 'obsolete'` to `PUT /api/v1/automation/NAME`. It also says that the toggle switches packaged flows only and refuses the clone, whatever flow the clone was copied from. The response shape is unchanged; only the notice text moves.
