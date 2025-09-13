import { ModuleRegistry } from '@deservefirst/core-module';
import { routes } from './config/routes';
import { permissions } from './config/permissions';
import { menu } from './config/menu';
import { PageService } from './services/PageService';
import { BlockService } from './services/BlockService';
import { UrlRewriteService } from './services/UrlRewriteService';
import { CustomFieldsService } from './services/CustomFieldsService';

export default class CMSModule {
  static async register() {
    await PageService.init();
    await BlockService.init();
    await UrlRewriteService.init();
    await CustomFieldsService.init();

    ModuleRegistry.registerModule({
      name: 'CMSModule',
      dependencies: ['CoreModule', 'RBACModule'],
      services: {
        PageService,
        BlockService,
        UrlRewriteService,
        CustomFieldsService,
      },
      events: {
        'page.created': 'Page created',
        'page.updated': 'Page updated',
        'block.created': 'Block created',
      },
      hooks: {
        'beforePageSave': 'Before page save',
        'afterPageSave': 'After page save',
      },
      routes,
      permissions,
      menu,
      settings: require('./config/settings.json'),
    });
  }
}
