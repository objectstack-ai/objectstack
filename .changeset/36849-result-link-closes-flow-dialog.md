---
'@object-ui/app-shell': patch
---

fix(console): following a record link on a screen flow's result screen closes the flow dialog

Clause-②: no
Metadata-protocol: none

On the last screen of a multi-screen screen flow, the screen that links the records the flow created, following one of those links now closes the flow dialog. The user lands on the record with nothing on top of it.

Before, the dialog stayed open over the record page and showed the flow's first screen again, with its inputs and a live Next. The record page draws a loading state on every record change, and the dialog was rebuilt from the step the run first paused on. Pressing Next sent the first screen's values to a run that was already on its last screen, and the user saw the engine's English refusal ("Invalid screen input: Unknown screen field …"). A lead conversion and a quote wizard both showed this after their records had been created.

Following a link in the same window now closes the dialog before the page changes:

- On a result screen (only record links, nothing after it), the run is also completed, the same way Done completes it: the completion toast, the refresh, and the host's completion callback.
- On any other screen, the link closes the dialog the way Cancel does and resumes nothing.
- A link opened in a new tab or window leaves the dialog where it is.

`ScreenView` takes an optional `onRecordLinkFollow` callback for this; the Studio preview passes none. Nothing to migrate.
