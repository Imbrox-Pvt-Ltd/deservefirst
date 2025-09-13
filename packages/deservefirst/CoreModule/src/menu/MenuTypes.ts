export interface MenuItem {
  id: string;
  label: string;
  url: string;
  icon?: string;
  permission?: string;
  context: 'admin' | 'frontend';
  order: number;
}
