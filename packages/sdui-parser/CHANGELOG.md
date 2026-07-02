# @objectstack/sdui-parser

## 11.7.0

## 11.6.0

## 11.5.0

## 11.4.0

## 11.3.0

## 11.2.0

### Minor Changes

- 012c046: ADR-0080 M3b: hoist the constrained JSX-source → SchemaNode compiler into framework as `@objectstack/sdui-parser` (its canonical home — pure, isomorphic, zero React). Parse, never execute: whitelist-sanitizing parser + manifest validation + `JSX.IntrinsicElements` codegen. Consumed server-side by the (forthcoming) `os build` save-gate for `kind:'jsx'` pages, and re-exportable by `@object-ui/sdui-parser` on the client.
