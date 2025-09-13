import { Router } from '@deservefirst/core-module';
import { PageService } from '../services/PageService';
import { BlockService } from '../services/BlockService';
import { UrlRewriteService } from '../services/UrlRewriteService';
import { CustomFieldsService } from '../services/CustomFieldsService';
import { PermissionService } from '@deservefirst/rbac-module';

export const routes = [
  {
    method: 'get',
    path: '/pages',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'cms:pages:read');
      const { tenantId, storeId } = req.query;
      const pages = await PageService.getPages(tenantId, storeId);
      res.json(pages);
    },
  },
  {
    method: 'post',
    path: '/pages',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'cms:pages:write');
      const { tenantId, storeId, ...data } = req.body;
      const page = await PageService.createPage(tenantId, storeId, data);
      res.json(page);
    },
  },
  {
    method: 'get',
    path: '/blocks',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'cms:blocks:read');
      const { tenantId, storeId } = req.query;
      const blocks = await BlockService.getBlocks(tenantId, storeId);
      res.json(blocks);
    },
  },
  {
    method: 'post',
    path: '/blocks',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'cms:blocks:write');
      const { tenantId, storeId, ...data } = req.body;
      const block = await BlockService.createBlock(tenantId, storeId, data);
      res.json(block);
    },
  },
  {
    method: 'get',
    path: '/urlrewrites',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'cms:urlrewrites:read');
      const { tenantId, storeId } = req.query;
      const urlRewrites = await UrlRewriteService.getUrlRewrites(tenantId, storeId);
      res.json(urlRewrites);
    },
  },
  {
    method: 'post',
    path: '/customfields',
    handler: async (req, res) => {
      await PermissionService.checkPermission(req.user, 'cms:customfields:write');
      const { tenantId, storeId, ...data } = req.body;
      const customField = await CustomFieldsService.createCustomField(tenantId, storeId, data);
      res.json(customField);
    },
  },
];
