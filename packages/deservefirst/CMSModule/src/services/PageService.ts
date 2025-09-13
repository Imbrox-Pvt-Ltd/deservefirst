import { Database, Events, Hooks } from '@deservefirst/core-module';
import Page from '../models/Page';

export class PageService {
  static async init() {
    // Initialize if needed
  }

  static async createPage(tenantId: string, storeId: string, data: any) {
    await Hooks.execute('beforePageSave', { tenantId, storeId, data });
    const page = await Database.create(Page, { ...data, tenantId, storeId });
    await Events.dispatch('page.created', page);
    await Hooks.execute('afterPageSave', page);
    return page;
  }

  static async getPages(tenantId: string, storeId: string) {
    return Database.find(Page, { tenantId, storeId });
  }

  static async getPageById(tenantId: string, storeId: string, id: string) {
    return Database.findOne(Page, { tenantId, storeId, id });
  }

  static async updatePage(tenantId: string, storeId: string, id: string, data: any) {
    await Hooks.execute('beforePageSave', { tenantId, storeId, id, data });
    const page = await Database.update(Page, { tenantId, storeId, id }, data);
    await Events.dispatch('page.updated', { id, ...data });
    await Hooks.execute('afterPageSave', { id, ...data });
    return page;
  }

  static async deletePage(tenantId: string, storeId: string, id: string) {
    return Database.delete(Page, { tenantId, storeId, id });
  }
}
