---
"@objectstack/rest": patch
---

fix(rest): the `/data` door's declared-4xx body carries human language in `error`, not the ADR-0111 `CODE:` prefix (#12975)

A producer that refuses with the ADR-0111 `CODE: message` idiom *and* declares
`{ code, status }` — `plugin-sharing`'s by-id write gate is the live in-repo
example — reached `/data` clients with the machine token glued to the front of
the human sentence. Since the sharing denial's copy moved onto the Operation
Message Catalog, a zh-CN user read this in a toast:

```text
FROM  {"error":"FORBIDDEN: 您无权修改或删除这条记录，如需修改请联系该记录的负责人或管理员。","code":"FORBIDDEN","object":"showcase_inquiry"}
TO    {"error":"您无权修改或删除这条记录，如需修改请联系该记录的负责人或管理员。","code":"FORBIDDEN","object":"showcase_inquiry"}
```

Maintainer ruling, 2026-08-29: one envelope semantics — `error` is human
language, `code` is the machine token. The token is unchanged and still on the
wire; only its duplicate inside the sentence is gone, so a client keying on
`code` (or on the `declaredCode` sibling for an unregistered spelling) reads
exactly what it read before.

**Scope — the strip is anchored to the producer's own declared `code`**, not to
a SCREAMING_SNAKE-then-colon pattern. Three consequences, each pinned:

- a declared 4xx carrying **no** `code` keeps its prefix, because the token
  rides nowhere else on that body and dropping it would be a loss rather than a
  move;
- a message opening with some **other** capitalised word and a colon is left
  alone — driver prose such as a SQLite "no such table" line is untouched;
- a message that is **nothing but** the prefix degrades to `Request failed`,
  the same generic sentence an absent or empty message already produced.

Every other branch of the door is byte-identical: declared 5xx (prose still
withheld whole), undeclared errors, the sandbox-refusal unwrap,
`DELETE_RESTRICTED`, `OBJECT_NOT_FOUND`, and any 4xx whose message never
carried the idiom.

**Consumer census** (recorded per the ruling's precondition): nothing parses
meaning out of the prefix. The only readers that touch it on the wire are three
display-side strippers in `objectui` (`packages/react/src/utils/error-message.ts`,
`plugin-detail`'s `InlineEditSaveBar.tsx` and `DetailView.tsx`), which delete it
for rendering and become no-ops. The prefix readers inside this repo all run
**in-process**, upstream of the wire — the `rest-server.ts` route mappings and
one `plugin-email` check on an error it threw itself — and are untouched.
