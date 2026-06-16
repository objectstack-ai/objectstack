---
---

chore(security): pin transitive `form-data` to `>=4.0.6` (GHSA-hmw2-7cc7-3qxx, high — CRLF injection via unescaped multipart field names). `4.0.5` was pulled in through `@vscode/vsce`; added a `pnpm-workspace.yaml` override so `pnpm audit --audit-level=high` (the `Validate Package Dependencies` CI gate) passes. No package version impact.
