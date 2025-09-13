import { MenuItem } from '@deservefirst/core-module';

export const menu: MenuItem[] = [
  {
    id: 'cms.pages',
    label: 'cms.menu.pages',
    url: '/admin/cms/pages',
    icon: 'page',
    permission: 'cms:pages:read',
    context: 'admin',
    order: 1,
  },
  {
    id: 'cms.blocks',
    label: 'cms.menu.blocks',
    url: '/admin/cms/blocks',
    icon: 'block',
    permission: 'cms:blocks:read',
    context: 'admin',
    order: 2,
  },
];
