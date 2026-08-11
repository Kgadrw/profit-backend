/** Page keys map to sidebar / app routes for workspace role-based access */
export const WORKSPACE_PAGES = [
  { key: 'dashboard', label: 'Overview', path: '/dashboard' },
  { key: 'products', label: 'Products', path: '/products' },
  { key: 'sales', label: 'Sales', path: '/sales' },
  { key: 'schedules', label: 'Automations', path: '/calendar/schedules' },
  { key: 'calendar', label: 'Calendar', path: '/calendar' },
  { key: 'team', label: 'Team', path: '/team' },
  { key: 'hr', label: 'HR', path: '/hr' },
  { key: 'projects', label: 'Projects', path: '/projects' },
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
  const normalized = normalizePermissions(permissions, role);
  if (pageKey === 'hr' && normalized.includes('team')) return true;
  if (pageKey === 'team' && normalized.includes('hr')) return true;
  if (pageKey === 'projects' && normalized.includes('team')) return true;
  if (pageKey === 'team' && normalized.includes('projects')) return true;
  if (pageKey === 'calendar' && normalized.includes('schedules')) return true;
  if (pageKey === 'schedules' && normalized.includes('calendar')) return true;
  return normalized.includes(pageKey);
}

/** Workspace owners/admins, or members explicitly granted the HR permission. */
export function canReviewLeaveRequests(role, permissions) {
  if (role === 'owner' || role === 'admin') return true;
  const normalized = normalizePermissions(permissions, role);
  return normalized.includes('hr');
}
