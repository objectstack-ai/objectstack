---
'@objectstack/skills': patch
---

docs(skills): the objectui testing guide stops teaching msw and shows a fetch double over the real adapter

Clause-②: no
Metadata-protocol: none

- **Before.** `skills/objectui/guides/testing.md` taught "MSW for API mocking in integration tests" with `import … from 'msw'` and `msw/node`. No package in this stack declares `msw` any more, so a test written from the guide cannot resolve its imports.
- **Now.** The subsection shows the pattern this repository's own integration tests use: a `vi.fn` passed as the `fetch` of a real `ObjectStackAdapter`, so the adapter and client run and only the wire is faked. It names one real test as the worked example. The guide stays within its token ceiling (3101 of 3101).
