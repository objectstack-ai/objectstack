---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): Home sends the deployment notice, authorized-clients and API-key reads once per load

Clause-②: no
Metadata-protocol: none

On a built Console, a cold load of Home sent `GET /api/settings/deployment/notice` twice and `GET /api/v1/auth/authorized-clients` and the `sys_api_key` list three times each. The repeats were not concurrent, so sharing an in-flight request could not remove them. Each had its own cause:

- **Home was mounted twice.** Home waits on the launcher's `pending` flag so that it never draws an app tile that `/me/apps` then hides. The `LauncherAppsProvider` set that flag from its effect, which runs after the first commit. So the first frame had nothing pending and nothing narrowed: Home drew its page, then switched to its loading state, then drew the page again. Everything inside it mounted twice, and the deployment notice and the Connect an AI Assistant card sent their reads twice. The first read is now `pending` from the render that makes it due. Home draws its page once, after the answer, and a hidden app's tile is never drawn in that first frame.
- **Two readers of one answer.** Home draws the Connect an AI Assistant card and the administrator's first-run checklist together. Both read "has this person connected an assistant" through `useConnectedAccess`, and each sent its own two requests. Every reader mounted at the same time now shares one pair of reads. A change to either record re-reads it once for all of them. The shared answer is dropped with its last reader, so a page mounted later reads afresh.

A list page load already read every URL once on a built Console, so nothing changes there.
