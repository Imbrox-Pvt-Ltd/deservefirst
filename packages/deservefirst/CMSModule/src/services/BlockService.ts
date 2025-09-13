import { Database, Events } from '@deservefirst/core-module';
import Block from '../models/Block';

export class BlockService {
  static async init() {
    // Initialize if needed
  }

  static async createBlock(tenantId: string, storeId: string, data: any) {
    const block = await Database.create(Block, { ...data, tenantId, storeId });
    await Events.dispatch('block.created', block);
    return block;
  }

  static async getBlocks(tenantId: string, storeId: string) {
    return Database.find(Block, { tenantId, storeId });
  }

  static async getBlockById(tenantId: string, storeId: string, id: string) {
    return Database.findOne(Block, { tenantId, storeId, id });
  }
}
