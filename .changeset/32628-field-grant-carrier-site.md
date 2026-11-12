---
'@objectstack/lint': patch
---

fix(lint): `field-no-consumers` lists a field-level permission grant (`permissions[].fields["<object>.<field>"]`) as a carrier site of the field it grants on

Clause-②: no
Metadata-protocol: none

- **`@objectstack/lint`:** a permission set's field-level grant is keyed `"<object>.<field>"` on the set's `fields` map, the only shape `PermissionSetSchema` accepts. `field-no-consumers` recorded that key as no site at all, so a field named only by such a grant was reported `inert`, and the `fix:` line ("remove the declaration together with its N carrier site(s)") named no grant to clean: following it deleted the field and left a grant masking a column that no longer exists. The key is now a carrier site of the field it names, so the field reads `carrier-only` and the `fix:` line names the grant, spelled `permissions[i].fields["<object>.<field>"]`.
- The key is read the way the runtime reads it: the head before the first `.` is the object, the whole remainder is the field. A key whose remainder is not a field the object declares (an unqualified key, a dotted remainder, a field or object that does not exist) names no site. A grant still reads nothing, so it never counts as a consumer.
- `os explain field-no-consumers` now names a field permission's row condition (`fields[...].when`) among the reads, and the grant key among the carriers.
