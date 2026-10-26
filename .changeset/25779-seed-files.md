---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/service-storage': minor
'@objectstack/runtime': minor
'@objectstack/cli': minor
---

feat(spec,metadata-protocol,service-storage,runtime,cli)!: a seed record can carry a file the package ships, `seedFile(path)`, and a file field's id that names no stored file is refused

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped. The narrowing is a seed load refusing a value it used to write: an id-shaped string in a file field that names no stored file. There is nothing for `objectstack migrate meta` to rewrite and no tombstone; the fix is the author's choice of the file the field should hold. -->

A `file`, `image`, `avatar`, `video` or `audio` field stores the id of a stored file, and only an upload made one, so a seed could not fill a required file field at all. A seed record now names the file by the path the package ships it at:

```ts
import { defineSeed, seedFile } from '@objectstack/spec/data';

defineSeed(ContractVersion, {
  externalId: 'code',
  records: [
    { code: 'NDA-001-V1', file: seedFile('fixtures/nda-v1.pdf') },
    { code: 'NDA-002-V1', file: seedFile('fixtures/nda-v2', { name: 'NDA v2.pdf', contentType: 'application/pdf' }) },
  ],
});
```

- **The path** is relative to the directory holding `objectstack.config.ts`, uses `/`, and stays inside it: an absolute path, a drive letter, a `\`, or an empty, `.` or `..` segment is refused at parse. A `multiple: true` file field takes an array of `seedFile(...)` values. `defineSeed` refuses `seedFile(...)` in a field that does not store a file.
- **`os build` / `os compile`** reads each referenced file and writes its bytes into the dataset's new `files` map (`{ contentType, size, sha256, data }`, base64), so the compiled artifact carries them to every boot that loads it: `os dev`, `os serve`, a published package, an artifact URL. A path that names no file, or a file whose type is neither named with `contentType` nor known by its extension, fails the build, and `os validate` refuses the same paths. `os serve` / `os dev` booting a config rather than an artifact reads the files the same way, so both boots seed the same files.
- **The seed loader** stores the bytes through the new `field-files` service (`FIELD_FILE_SERVICE`, `IFieldFileService`, registered by `@objectstack/service-storage`), writes the file's id into the field, and makes the written record the file's owner, the (object, record, field) ownership an upload gets. Each row gets a file of its own. A replay that finds the row holding a file stored from the same path with the same bytes, name and type keeps it, so a restart does not store a new file for an unchanged fixture. A file stays `pending` until its row lands, so a file whose row is refused is reclaimed by the pending-upload retention.
- **Refused, by row, before the row is written**: a reference whose bytes the dataset does not carry, bytes that do not match their recorded size and SHA-256, a load with no `field-files` service, a field mixing `seedFile(...)` with other values, and several `seedFile(...)` values in a one-file field. Each is counted, reported in the load's errors and logged at `error`.
- **The inline boot seed** of an app whose datasets carry seed files runs at `kernel:bootstrapped` (as one with `demoStaff` already does), once the storage service has read its settings, so the files land in the store the deployment serves from.
- `SeedLoaderService` takes an optional fourth argument, `{ getFieldFiles }`; every platform caller passes the kernel's `field-files` service.

**BREAKING** (a seed-load narrowing). A seed record whose file field holds an id-shaped string (letters, digits, `_` and `-`, at most 64 characters) that names no stored file in the row's organization is now refused, by row, with an error naming the field and the value. Before, it was written as given, and the field then read as holding no file. An external URL or an inline value is not an id and is written as before; so is any value on a deployment without `@objectstack/service-storage`.

**What to do.** If a seed load now reports `… holds '<value>', which names no stored file`, replace the value with the file the field should hold, `seedFile('<path in the package>')`, or remove it.
