// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as System from '@objectstack/spec/system';
import { ISchemaDriver } from '@objectstack/spec/contracts';

export class MigrationExecutor {
  constructor(private driver: ISchemaDriver) {}

  async executeChangeSet(changeSet: System.ChangeSetParsed): Promise<void> {
    console.log(`Executing ChangeSet: ${changeSet.name} (${changeSet.id})`);
    
    for (const op of changeSet.operations) {
      try {
        await this.executeOperation(op);
      } catch (e) {
        console.error(`Failed to execute operation ${op.type}:`, e);
        throw e;
      }
    }
  }

  private async executeOperation(op: System.MigrationOperationParsed): Promise<void> {
    switch (op.type) {
      case 'create_object':
        console.log(`  > Create Object: ${op.object.name}`);
        await this.driver.createCollection(op.object.name, op.object);
        break;
      case 'add_field':
        console.log(`  > Add Field: ${op.objectName}.${op.fieldName}`);
        await this.driver.addColumn(op.objectName, op.fieldName, op.field);
        break;
      case 'remove_field':
        console.log(`  > Remove Field: ${op.objectName}.${op.fieldName}`);
        await this.driver.dropColumn(op.objectName, op.fieldName);
        break;
      case 'delete_object':
        console.log(`  > Delete Object: ${op.objectName}`);
        await this.driver.dropCollection(op.objectName);
        break;
      case 'execute_sql':
        console.log(`  > Execute SQL`);
        await this.driver.executeRaw(op.sql);
        break;
      case 'modify_field':
        console.warn(`  ! Modify Field: ${op.objectName}.${op.fieldName} (Not fully implemented)`);
        break;
      case 'rename_object':
        console.warn(`  ! Rename Object: ${op.oldName} -> ${op.newName} (Not fully implemented)`);
        break;
      default:
        throw new Error(`Unknown operation type`);
    }
  }
}
