---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): the report quick edit saves the report's own text, not the served translation

Clause-②: no
Metadata-protocol: none

The in-app report editor (a report page's Edit button) seeded its form from the report as the console was served it. In a non-source locale that copy is translated (the report's label, description and each block's label), and the metadata save stores a report body as sent, so saving any edit stored the translations as the report's source text: after a publish, readers in every other language were shown them. The editor now edits the report as its author stored it, read from the layered metadata read the Studio editors already use (the pending draft when there is one, else the published report), and keeps the served copy for display. If that read fails, the editor says so and does not open. The draft bar in the editor no longer resumes the served (translated) draft over it.
