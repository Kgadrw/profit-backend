import WorkspaceCategory from '../models/WorkspaceCategory.js';
import TeamMember from '../models/TeamMember.js';
import TeamTask from '../models/TeamTask.js';
import {
  DEFAULT_WORKSPACE_CATEGORIES,
  WORKSPACE_CATEGORY_TYPES,
  slugifyCategoryKey,
} from '../constants/workspaceCategories.js';
import { buildListQuery, buildCreateScope } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (!WORKSPACE_CATEGORY_TYPES.includes(value)) {
    throw new Error('Invalid category type');
  }
  return value;
}

function mergeCategories(type, customRows) {
  const defaults = DEFAULT_WORKSPACE_CATEGORIES[type] || [];
  const customByKey = new Map(customRows.map((row) => [row.key, row]));
  const merged = defaults.map((item) => {
    const custom = customByKey.get(item.key);
    if (custom) customByKey.delete(item.key);
    return {
      key: item.key,
      label: custom?.label || item.label,
      isDefault: true,
      id: custom?._id ? String(custom._id) : null,
      isCustom: Boolean(custom),
    };
  });

  for (const row of customByKey.values()) {
    merged.push({
      id: String(row._id),
      key: row.key,
      label: row.label,
      isDefault: false,
      isCustom: true,
      sortOrder: row.sortOrder ?? 0,
    });
  }

  merged.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' });
  });

  return merged;
}

export const getWorkspaceCategories = async (req, res) => {
  try {
    const type = normalizeType(req.query.type);
    const query = buildListQuery(req, { type });
    const customRows = await WorkspaceCategory.find(query).sort({ sortOrder: 1, label: 1 });
    res.json({ data: mergeCategories(type, customRows) });
  } catch (error) {
    if (error.message === 'Invalid category type') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error fetching workspace categories:', error);
    handleScopeError(res, error);
  }
};

export const createWorkspaceCategory = async (req, res) => {
  try {
    const type = normalizeType(req.body.type);
    const label = String(req.body.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Category name is required' });

    const key = slugifyCategoryKey(req.body.key || label);
    const defaults = DEFAULT_WORKSPACE_CATEGORIES[type] || [];
    const defaultKeys = new Set(defaults.map((item) => item.key));

    const scopeQuery = buildListQuery(req, { type, key });
    const existing = await WorkspaceCategory.findOne(scopeQuery);
    if (existing || defaultKeys.has(key)) {
      return res.status(409).json({ error: 'A category with this name already exists' });
    }

    const row = await WorkspaceCategory.create({
      ...buildCreateScope(req),
      type,
      key,
      label,
      sortOrder: Number(req.body.sortOrder) || 0,
    });

    res.status(201).json({
      data: {
        id: String(row._id),
        key: row.key,
        label: row.label,
        isDefault: false,
        isCustom: true,
      },
    });
  } catch (error) {
    if (error.message === 'Invalid category type') {
      return res.status(400).json({ error: error.message });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'A category with this name already exists' });
    }
    console.error('Error creating workspace category:', error);
    handleScopeError(res, error);
  }
};

export const updateWorkspaceCategory = async (req, res) => {
  try {
    const row = await WorkspaceCategory.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!row) return res.status(404).json({ error: 'Category not found' });

    const label = req.body.label !== undefined ? String(req.body.label).trim() : row.label;
    if (!label) return res.status(400).json({ error: 'Category name is required' });

    row.label = label;
    if (req.body.sortOrder !== undefined) {
      row.sortOrder = Number(req.body.sortOrder) || 0;
    }
    await row.save();

    res.json({
      data: {
        id: String(row._id),
        key: row.key,
        label: row.label,
        isDefault: false,
        isCustom: true,
      },
    });
  } catch (error) {
    console.error('Error updating workspace category:', error);
    handleScopeError(res, error);
  }
};

export const deleteWorkspaceCategory = async (req, res) => {
  try {
    const row = await WorkspaceCategory.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!row) return res.status(404).json({ error: 'Category not found' });

    if (row.type === 'department') {
      const scope = buildListQuery(req);
      const [memberCount, taskCount] = await Promise.all([
        TeamMember.countDocuments({ ...scope, department: row.key }),
        TeamTask.countDocuments({ ...scope, department: row.key }),
      ]);
      if (memberCount > 0 || taskCount > 0) {
        return res.status(409).json({
          error: 'This department is in use by team members or tasks and cannot be deleted',
        });
      }
    }

    await row.deleteOne();
    res.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting workspace category:', error);
    handleScopeError(res, error);
  }
};
