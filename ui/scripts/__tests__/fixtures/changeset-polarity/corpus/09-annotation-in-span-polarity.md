---
'@object-ui/types': minor
---

The polarity fixture for objectui#9832, written in the spelling ADR-0049
settled on objectui#9764 -- a by-name refusal tombstone, whose type annotation
is spelled with the same six letters as an English negator.

**Two published faces, one retirement.** The TypeScript interface
`ObjectKanbanSchema` declares `allowCollapse?: never`, so a document that
authors the key is refused at compile time by name.

**The zod twin, whose negator is a call expression rather than an annotation.**
`ObjectKanbanSchema` declares `z.never().optional()` for the retired key, and
parsing a document that carries `titleField` fails on that path.

**The prose leg, which has to keep reading as a negation.**
`ObjectKanbanSchema` never declares `cardTitle`.
