---
---

Docs-only: adds ADR-0131 (organization ownership is total — no NULL `organization_id`; declared
metadata stays in code and is never seeded; a row exists only when an organization authored it;
references by name; deployment-level state has no organization column) and annotates ADR-0105 D10
as withdrawn. Releases nothing — no package changes. The ADR is Proposed; implementation cards are
cut from it after the maintainer's hand-merge (Prime Directive #14), never ahead of it. Refs #13564.
