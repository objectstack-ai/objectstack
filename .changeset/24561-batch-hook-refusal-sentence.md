---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a batch row answers a sandboxed hook's refusal in the hook's own words

Clause-②: no (no accept set or route moves, and a row keeps its shape: a sandboxed hook's refusal now carries the sentence and code the other data doors already answer)

- **A sandboxed hook's refusal reads as its sentence on a batch row.** When a sandboxed hook body refused a row with `throw new Error('…')`, `POST /api/v1/data/:object/batch` answered that row with `code: 'INTERNAL_ERROR'` and `The create of this record failed. The reason is in the server log.` `POST /data/:object`, `/createMany` and `/import` answer the hook's sentence. The row now carries that sentence and `code: 'VALIDATION_ERROR'`, the code those doors give a refusal that declared no code or status. Rows of `updateMany` and `deleteMany` answer the same way. The row still has no `httpStatus`, because the hook declared none.
- **A code or status the hook declared still rides.** For a refusal that declared a 4xx status, the row used to quote the `hook 'NAME' threw: Error: …` debug wrapper. It now quotes the hook's sentence.
- **Unchanged:** a hook body that crashed, a refusal that declared a 5xx, the sandbox's own faults (a time or CPU budget, a denied capability) and driver errors keep the withheld sentence and the server-log warning. A crashed body that declared a 4xx is now withheld as well. Before, the row quoted its wrapper with the native error text.
