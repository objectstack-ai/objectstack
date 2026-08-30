---
"@objectstack/service-datasource": patch
---

fix(service-datasource): derive `ConnectionEngineLike` from the engine contract instead of re-declaring it, and stop promising `registerDriver` accepts any value (#12010)

`ConnectionEngineLike` — the exported view `DatasourceConnectionService` drives
the ObjectQL `'data'` engine through — hand-declared seven engine members. The
#12010 inventory measured what that cost, and one half of it was unsafe rather
than merely duplicated.

**The unsafe half.** The seam declared
`registerDriver?: (driver: unknown, isDefault?: boolean) => void`,
while the engine contract declares `registerDriver(driver: IDataDriver,
isDefault?: boolean): void`. Under `strictFunctionTypes` that made the real
engine **not assignable** to this view, and it told every consumer of the
exported type that the engine accepts *any* value as a driver — which it does
not, so a mis-shaped driver reaching `registerDriver` was a runtime problem the
type was structured not to see. The parameter is now the contract's
`IDataDriver`, which repairs both halves at once: the seam stops over-promising
AND the engine becomes assignable to it.

**The duplicated half.** Three members (`registerDatasourceDef`,
`markDatasourceUnavailable`, `clearDatasourceUnavailable`) were declared by no
contract at all when the card was filed — real `ObjectQL` methods, called
across a package boundary, meeting no compiler on the producer side. #12248
adjudicated all three onto `IDataEngine`, and #12482 followed with
`syncObjectSchema`. All seven members are now **derived**
(`Partial<Pick<IObjectQLEngine, …>>`) rather than re-written, the same #4251 B3
move `datasource-admin-plugin.ts` already made for its sibling `DataEngineLike`
one file over. Drift now lands as a build error here instead of a silent
disagreement.

`Partial` is preserved deliberately: `registerDriver` is required on the
contract, while this service treats its absence as graceful degradation (the
datasource is left metadata-only, `'skipped-no-infra'`). Making it required
would change what a lightweight kernel does at boot.

No runtime behaviour changes. The one cast the factory escape hatch still needs
(`DatasourceDriverHandle.driver` is declared `unknown`, open to any host-built
driver) moved to the single call site that constructs the value, and the
`disconnect()` path dropped its cast entirely now that `getDriverByName` answers
the contract's `IDataDriver | undefined`.

**For hosts:** if you implement `ConnectionEngineLike` directly, its members are
now the engine contract's members. An implementation whose `registerDriver`
takes a wider parameter (`unknown`, `any`) is still accepted; one that returns a
narrower value from `getDriverByName` than `IDataDriver | undefined` is not, and
should answer the contract type.
