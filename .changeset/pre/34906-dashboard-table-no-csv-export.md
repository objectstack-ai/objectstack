---
'@object-ui/plugin-dashboard': patch
'@object-ui/i18n': patch
---

fix(plugin-dashboard): the dashboard table widget no longer offers an "Export CSV" download

Clause-②: no
Metadata-protocol: none

The dataset table and cross-tab widgets drew a download button that built a CSV in the browser. That file skipped the export grant and the export audit entry that list export enforces. The button, its CSV helpers and the `dashboard.exportCsv` label in every locale pack are removed. To take rows out, use list export, which checks the export grant and writes the audit entry. Report exports are unchanged.
