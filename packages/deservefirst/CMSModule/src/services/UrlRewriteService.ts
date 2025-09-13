import { Database } from '@deservefirst/core-module';
import UrlRewrite from '../models/UrlRewrite';

export class UrlRewriteService {
  static async init() {
    // Initialize if needed
  }

  static async createUrlRewrite(tenantId: string, storeId: string, data: any) {
    return Database.create(UrlRewrite, { ...data, tenantId, storeId });
  }

  static async getUrlRewrites(tenantId: string, storeId: string) {
    return Database.find(UrlRewrite, { tenantId, storeId });
  }
}
