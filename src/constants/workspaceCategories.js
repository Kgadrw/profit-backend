export const WORKSPACE_CATEGORY_TYPES = ['department', 'expense', 'product', 'document', 'income'];

export const DEFAULT_WORKSPACE_CATEGORIES = {
  department: [
    { key: 'general', label: 'General' },
    { key: 'finance', label: 'Finance' },
    { key: 'operations', label: 'Operations' },
    { key: 'sales', label: 'Sales' },
    { key: 'marketing', label: 'Marketing' },
    { key: 'hr', label: 'HR' },
  ],
  expense: [
    { key: 'general', label: 'General' },
    { key: 'supplies', label: 'Supplies' },
    { key: 'rent', label: 'Rent' },
    { key: 'utilities', label: 'Utilities' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'marketing', label: 'Marketing' },
    { key: 'travel', label: 'Travel' },
    { key: 'other', label: 'Other' },
  ],
  product: [
    { key: 'general', label: 'General' },
    { key: 'retail', label: 'Retail' },
    { key: 'wholesale', label: 'Wholesale' },
    { key: 'services', label: 'Services' },
    { key: 'service', label: 'Service' },
  ],
  document: [
    { key: 'general', label: 'General' },
    { key: 'legal', label: 'Legal' },
    { key: 'tax', label: 'Tax' },
    { key: 'contracts', label: 'Contracts' },
    { key: 'licenses', label: 'Licenses' },
    { key: 'hr', label: 'HR' },
    { key: 'finance', label: 'Finance' },
    { key: 'financial', label: 'Financial' },
    { key: 'other', label: 'Other' },
  ],
  income: [
    { key: 'general', label: 'General' },
    { key: 'sales', label: 'Sales' },
    { key: 'services', label: 'Services' },
    { key: 'other', label: 'Other' },
  ],
};

export function slugifyCategoryKey(label) {
  const key = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'custom';
}
