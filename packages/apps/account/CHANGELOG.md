# @objectstack/account

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/platform-objects@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0

## 9.4.0

### Minor Changes

- 593d43b: feat(apps): reclaim `@objectstack/account` for the console Account app (ADR-0048)

  Removes the deprecated standalone account-portal SPA (`apps/account`) and
  reclaims the `@objectstack/account` name for the console Account app as its own
  ObjectStack package (`com.objectstack.account`, namespace `account`) per
  ADR-0048 "one app per package". Boot-neutral skeleton (transitional import from
  platform-objects; not yet wired into the dev/serve plugin set — that switch
  lands in a follow-up verified against a live `os dev` boot).

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/platform-objects@9.4.0
