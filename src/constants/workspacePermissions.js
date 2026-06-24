/** Page keys map to sidebar / app routes for workspace role-based access */
export const WORKSPACE_PAGES = [
  { key: 'dashboard', label: 'Overview', path: '/dashboard' },
  { key: 'products', label: 'Products', path: '/products' },
  { key: 'sales', label: 'Sales', path: '/sales' },
  { key: 'schedules', label: 'Automations', path: '/schedules' },
  { key: 'calendar', label: 'Calendar', path: '/calendar' },
  { key: 'team', label: 'Team', path: '/team' },
  { key: 'finance', label: 'Finance', path: '/finance/income' },
  { key: 'reports', label: 'Reports', path: '/reports' },
  { key: 'documents', label: 'Documents', path: '/documents' },
];

export const ALL_WORKSPACE_PAGE_KEYS = WORKSPACE_PAGES.map((p) => p.key);

export const DEFAULT_MEMBER_PERMISSIONS = ['dashboard', 'products', 'sales'];

export function normalizePermissions(permissions, role) {
  if (role === 'owner' || role === 'admin') {
    return ALL_WORKSPACE_PAGE_KEYS;
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    return [...DEFAULT_MEMBER_PERMISSIONS];
  }
  return permissions.filter((key) => ALL_WORKSPACE_PAGE_KEYS.includes(key));
}

export function canAccessWorkspacePage(role, permissions, pageKey) {
  if (role === 'owner' || role === 'admin') return true;
  return normalizePermissions(permissions, role).includes(pageKey);
}
