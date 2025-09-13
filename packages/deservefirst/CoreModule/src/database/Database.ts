export interface SchemaOptions {
  timestamps?: boolean;
  [key: string]: any;
}

export class Database {
  static createSchema(definition: any, options: SchemaOptions = {}) {
    return DatabaseProvider.createSchema(definition, options);
  }

  static model(name: string, schema: any) {
    return DatabaseProvider.model(name, schema);
  }

  static async create(model: any, data: any) {
    return DatabaseProvider.create(model, data);
  }

  static async find(model: any, query: any) {
    return DatabaseProvider.find(model, query);
  }

  static async findOne(model: any, query: any) {
    return DatabaseProvider.findOne(model, query);
  }

  static async update(model: any, query: any, data: any, options: any = {}) {
    return DatabaseProvider.update(model, query, data, options);
  }

  static async delete(model: any, query: any) {
    return DatabaseProvider.delete(model, query);
  }
}

import { MemoryProvider } from './providers/MemoryProvider';

export let DatabaseProvider = MemoryProvider;
