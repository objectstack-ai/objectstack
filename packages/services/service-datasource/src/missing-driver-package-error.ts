// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The typed "an OPTIONAL driver package is not installed" failure — declared
 * here, in the LOWEST package that raises it, so there is exactly one class
 * object across every loader (#7314).
 *
 * ## Why it lives here rather than where it was written
 *
 * It was declared in `@objectstack/runtime`
 * (`turso-driver-factory.ts`) under #6268, which converged the two HOST-injected
 * libSQL loaders (CLI + standalone stack) onto one owner. That convergence was
 * complete for the hosts and could not reach the third loader: the open-core
 * `createDefaultDatasourceDriverFactory` in THIS package, which serves every
 * door that is not a host's `default` datasource — a datasource created in
 * Setup, `testConnection`, a declared non-default datasource.
 *
 * `@objectstack/runtime` depends on `@objectstack/service-datasource`, never the
 * reverse, so the open-core arm could not import the class and raised a plain
 * `Error` instead. The two legal ways out were "declare a second same-named
 * class here" — precisely the identity hazard #6268 closed — or move the one
 * class DOWN to where both sides can reach it. This is the move. `runtime`
 * RE-EXPORTS it from its old home, so every existing importer
 * (`@objectstack/runtime`, `@objectstack/cli`'s `storage-driver.ts`, and
 * `serve.ts` through it) keeps compiling and keeps testing the same class.
 *
 * ## What depends on there being ONE class
 *
 * `packages/cli/src/commands/serve.ts` decides whether a boot failure is FATAL
 * with `e instanceof MissingDriverPackageError`. Two same-named classes — one
 * per package — would make that predicate silently stop matching and degrade a
 * fatal branch to a non-fatal one with no diagnostic anywhere: nothing in the
 * message would change, so no message assertion could see it. That is why the
 * pins on this class assert IDENTITY (`===`, `instanceof`) rather than `name`
 * or message text.
 */

/**
 * Thrown when the OPTIONAL driver package a datasource selection needs is not
 * installed, or resolves to something that is not the driver (a shadowing stub,
 * a truncated install, a major that renamed the export).
 *
 * The install command rides as a FIELD as well as inside the message, so a
 * caller can render the remedy however it likes and a pin test can assert the
 * command rather than a sentence shape.
 *
 * `driverType` is the engine that was asked for, not a libSQL-only field: the
 * `mongodb` and `sqlite-wasm` arms of the same factory answer the same class of
 * problem with an untyped `Error` today (#7385), and adopting this class is a
 * constructor call away when that lane takes it up.
 */
export class MissingDriverPackageError extends Error {
  readonly driverType: string;
  readonly packageName: string;
  readonly installCommand: string;
  constructor(args: { driverType: string; packageName: string; installCommand: string; message: string }) {
    super(args.message);
    this.name = 'MissingDriverPackageError';
    this.driverType = args.driverType;
    this.packageName = args.packageName;
    this.installCommand = args.installCommand;
  }
}
