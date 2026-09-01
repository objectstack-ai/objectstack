---
"@objectstack/service-storage": patch
---

fix(service-storage): the `storage/test` probe cleans up in the store it wrote to (#13726)

The settings action behind the storage screen's "Test" button writes a small
`__objectstack_probe__/…` object, reads it back, and deletes it. When the form
posts values it builds a **temporary** adapter first, so an operator can
validate credentials that are typed but not yet saved, and probes that adapter
instead of the persisted one. Two paths left the probe object behind in the
customer's bucket.

- **The failure cleanup deleted from the wrong store.** `target` was declared
  inside the `try`, so the `catch` could only name the persisted adapter — even
  when the probe had written to the temporary one, which is the whole case the
  temporary adapter exists for. Deleting a key that was never there is a no-op
  on both shipped adapters, so the wrong-store delete "succeeded" and nothing
  looked wrong. The adapter is now resolved before that `try`, which makes the
  cleanup name the store the upload named by construction.
- **The content-mismatch return path cleaned up nothing.** Reaching that
  comparison means the upload already succeeded, so the object is definitely
  there — and the `return` walked straight past the delete on the next line. It
  now runs the same best-effort cleanup as the failure path, which also carries
  the "cleanup refused — here is the key it left behind" warning to this path
  for the first time.

One stray object accrued per failed test, under a name minted per call from a
timestamp and a random suffix and recorded nowhere, in whichever store the probe
actually wrote to — a button whose entire purpose is to be pressed repeatedly
while credentials are being got right.

An adapter that fails to *construct* still attempts no cleanup: nothing has been
written at that point, and the delete would have to name an adapter that does
not exist. What the probe reports to the operator is unchanged on every path.
