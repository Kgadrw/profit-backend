/** Page keys map to sidebar / app routes for workspace role-based access */
export const WORKSPACE_PAGES = [
  { key: 'dashboard', label: 'Overview', path: '/dashboard' },
  { key: 'products', label: 'Products', path: '/products' },
  { key: 'sales', label: 'Sales', path: '/sales' },
  { key: 'schedules', label: 'Automations', path: '/calendar/schedules' },
  { key: 'calendar', label: 'Calendar', path: '/calendar' },
  { key: 'team', label: 'Team', path: '/team' },
  { key: 'projects', label: 'Projects', path: '/projects' },
  { key: 'crm', label: 'CRM', path: '/crm' },
  { key: 'finance', label: 'Finance', path: '/finance/income' },
  { key: 'reports', label: 'Reports', path: '/reports' },
  { key: 'documents', label: 'Documents', path: '/documents' },
  { key: 'assets', label: 'Assets', path: '/assets' },
  { key: 'approvals', label: 'Approvals', path: '/approvals' },
  { key: 'chat', label: 'Messages', path: '/messages' },
];

export const ALL_WORKSPACE_PAGE_KEYS = WORKSPACE_PAGES.map((p) => p.key);

export const DEFAULT_MEMBER_PERMISSIONS = ['dashboard', 'products', 'sales', 'chat'];

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
