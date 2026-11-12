---
'@objectstack/spec': minor
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/rest': patch
'@objectstack/plugin-email': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-security': patch
'@object-ui/app-shell': patch
---

feat(runtime): a script body sends mail and adds a timeline entry through platform doors that stamp who sent it

Clause-②: yes (widening)
Metadata-protocol: added

- **`@objectstack/spec`:** two new body capabilities, `email.send` and `activity.append`, and their inputs `BodyMailSendInputSchema` and `BodyActivityAppendInputSchema` (`@objectstack/spec/data`). The sender, the sending user, the organization, the actor and the origin are stamped by the platform and are not inputs: a key outside either shape is refused. `SYS_ACTIVITY_PLATFORM_TYPES` names the timeline types only the platform records.
- **`@objectstack/runtime`:** a hook, action or job body that declares the capability calls `ctx.email.send({ to, subject, text })` or `ctx.activity.append({ object, recordId, type, summary })`. A message is sent from the configured sender, as the calling user, under the caller's organization; a timeline entry is written with the calling user as its actor and the package and body as its origin. A record the call points at must be one the caller can read. A message names at most 50 recipients, and an organization's mail is held to `OS_EMAIL_APP_SEND_HOURLY_LIMIT` messages an hour (default 200) before the door refuses another. A body with no calling user (a job) sends and writes with no user recorded.
- **`@objectstack/cli`:** the build infers both capabilities from a handler's calls, under a renamed or destructured context too.
- **`@objectstack/core`:** the bounds a caller-sent message is held to (the sending user, the organization, the configured sender) are one function, `boundCallerMail`, shared by the REST mail door and the body door.
- **`@objectstack/rest`:** the REST mail door reads its bounds from `boundCallerMail`; its answers are unchanged.
- **`@objectstack/plugin-email`:** a mail-log row the mail service did not write is delivered from the configured sender.
- **`@objectstack/plugin-audit`:** the activity feed owns the door's writer, `appendAppActivity` on the `audit` service. An app's entry may not use a platform-only type or a platform metadata key, and may not be about an object the feed does not show or an append-only object. `sys_activity` gains a read-only `origin` column, empty on an entry the platform recorded.
- **`@objectstack/plugin-security`:** inserting into an append-only object from app automation that runs as system is deprecated, and says so once per kind and object, naming the two doors.
- **`@object-ui/app-shell`:** the script capability picker lists both capabilities with their calls.
