---
"@objectstack/rest": patch
---

fix(rest): the API-exposure check on every `/data` request reads only the object it checks, not the whole object list

Clause-②: no

- **Faster `/data` requests.** Before each `/data` read or write, the REST layer checks the object's `enable.apiEnabled` and `enable.apiMethods`. To read that one object's flags, the check used to load every object's metadata and run a full schema diagnostic on each one. It now reads only the object named in the URL. Measured on the showcase app on a shared machine: 33 `GET /api/v1/data/showcase_account` calls took 647 ms instead of 2421 ms (-73 %), and the metadata read behind the check fell from 56-61 ms to about 4.5 ms per request.
- **Same answers.** Code-registered objects, objects stored in the environment and objects that another package extends get the same `404 OBJECT_API_DISABLED` and `405 OBJECT_API_METHOD_NOT_ALLOWED` as before. An unknown object is still answered by the data path's `404 OBJECT_NOT_FOUND`. When the metadata store cannot be read, the check still lets the request through and logs its `api-exposure gate` warning. Nothing is cached, so a metadata change applies from the next request.
- **One refusal changes, for an object whose package is disabled.** A denied operation on such an object now gets the exposure answer instead of the disabled-package one:
  - an operation outside `apiMethods`: FROM `404 OBJECT_PACKAGE_DISABLED` TO `405 OBJECT_API_METHOD_NOT_ALLOWED`;
  - any operation on an object with `apiEnabled: false`: FROM `404 OBJECT_PACKAGE_DISABLED` TO `404 OBJECT_API_DISABLED`.

  An allowed operation still answers `404 OBJECT_PACKAGE_DISABLED`. No accepted request is now refused, and no refused request is now accepted.
