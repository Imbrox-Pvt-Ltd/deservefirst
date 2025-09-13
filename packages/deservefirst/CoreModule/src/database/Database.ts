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

export let DatabaseProvider = {
  configure: (config: any) => { throw new Error('DatabaseProvider not configured'); },
  createSchema: (definition: any, options: any) => { throw new Error('DatabaseProvider not configured'); },
  model: (name: string, schema: any) => { throw new Error('DatabaseProvider not configured'); },
  create: async (model: any, data: any) => { throw new Error('DatabaseProvider not configured'); },
  find: async (model: any, query: any) => { throw new Error('DatabaseProvider not configured'); },
  findOne: async (model: any, query: any) => { throw new Error('DatabaseProvider not configured'); },
  update: async (model: any, query: any, data: any, options: any) => { throw new Error('DatabaseProvider not configured'); },
  delete: async (model: any, query: any) => { throw new Error('DatabaseProvider not configured'); },
};
