---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-security': patch
'@objectstack/cli': patch
---

feat(spec, platform-objects): the standard unit table and the organization unit object `sys_unit` (ADR-0158 U1–U3)

Clause-②: yes (widening)
Metadata-protocol: none

Units of measure, first release (ADR-0158 U7 R1). Nothing reads these tables yet: the unit declaration on a `number` field, the write-time membership check and the display of a quantity with its unit ship with their own cards. No field key ships here.

- **`@objectstack/spec`** (`@objectstack/spec/data`) exports `STANDARD_UNITS`, a closed table of 41 UN/ECE Recommendation 20 codes. Each code carries its dimension (`UNIT_DIMENSIONS`: `mass`, `length`, `area`, `volume`, `time`, `count`, `package`) and its ratio to the dimension's base unit (`UNIT_DIMENSION_BASE_CODES`: `KGM`, `MTR`, `MTK`, `MTQ`, `SEC`, `H87`), as an exact decimal string: `1 CODE = ratio × BASE`. Package codes (`XBX`, `XCT`, `XPX`, …) carry no ratio. The piece is `H87`; `C62` and `EA` are not members. `ORGANIZATION_UNIT_CODE_PATTERN` is the namespace of an organization's own codes (uppercase letters, digits and underscores, at least 4 characters or containing an underscore), which no standard code can match. `PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']` gains `sys_unit`. The table is not a value domain: `ValueDomainSchema` keeps its three members.
- **`@objectstack/platform-objects`** registers `sys_unit` (Setup → Configuration → Units of Measure), an organization's own units: `code`, `label`, `dimension`, `ratio` (scale 12; required on every dimension but `package`, refused on `package`), `decimal_places` (a display default) and `retired`. It is organization-owned behind the tenant wall and ships no rows. A code outside the organization namespace is refused, the code is unique within the organization, and the code and dimension cannot change after create. A unit is retired instead of deleted, and retiring cannot be undone, so a code is never created again with another meaning; the data API serves no delete on it. Every column carries field history.
- **`@objectstack/plugin-security`**: `member_default` reads `sys_unit`, so a unit's label displays to every member; organization administrators write it through their existing grant.
- **`@objectstack/cli`**: the organization-ownership inventory lists `sys_unit` as attributed to its organization.
