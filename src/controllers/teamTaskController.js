import mongoose from 'mongoose';
import TeamTask from '../models/TeamTask.js';
import TeamMember from '../models/TeamMember.js';
import User from '../models/User.js';
import Project from '../models/Project.js';
import ProjectMilestone from '../models/ProjectMilestone.js';
import Notification from '../models/Notification.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { broadcastScopeChange } from '../utils/workspaceRealtime.js';
import { assertCurrentUserIsAssignee } from '../utils/taskAssigneeAccess.js';
import {
  applyTaskProgressTouch,
  applyTaskStatusActivity,
  initialTaskActivityFields,
} from '../utils/taskActivity.js';
import {
  sendEmail,
  renderEmailTemplate,
  getFrontendBaseUrl,
} from '../utils/emailService.js';

const DEFAULT_REMINDER_OFFSETS = [1440, 60];
const MAX_SUBTASKS = 40;

function normalizeSubtasks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const title = String(item?.title || '').trim().slice(0, 200);
      if (!title) return null;
      const row = {
        title,
        done: Boolean(item?.done),
      };
      if (item?._id && mongoose.Types.ObjectId.isValid(item._id)) {
        row._id = item._id;
      }
      return row;
    })
    .filter(Boolean)
    .slice(0, MAX_SUBTASKS);
}

function subtaskDoneById(list) {
  const map = new Map();
  for (const row of list || []) {
    if (row?._id) map.set(String(row._id), Boolean(row.done));
  }
  return map;
}

function hasSubtaskStructureChanged(existing, next) {
  if ((existing || []).length !== (next || []).length) return true;
  return next.some((row, index) => {
    const prev = existing[index];
    if (!prev) return true;
    if (String(prev.title || '') !== String(row.title || '')) return true;
    return String(prev._id || '') !== String(row._id || '');
  });
}

function hasSubtaskDoneChanged(existing, next) {
  const prevDone = subtaskDoneById(existing);
  return next.some((row, index) => {
    if (row._id && prevDone.has(String(row._id))) {
      return Boolean(row.done) !== prevDone.get(String(row._id));
    }
    const prev = existing[index];
    if (!prev) return Boolean(row.done);
    return Boolean(row.done) !== Boolean(prev.done);
  });
}

function applySubtasksKeepingDone(existing, next) {
  const prevDone = subtaskDoneById(existing);
  const prevByTitle = new Map();
  for (const row of existing || []) {
    if (!prevByTitle.has(row.title)) prevByTitle.set(row.title, Boolean(row.done));
  }
  return next.map((row) => {
    let done = false;
    if (row._id && prevDone.has(String(row._id))) {
      done = prevDone.get(String(row._id));
    } else if (prevByTitle.has(row.title)) {
      done = prevByTitle.get(row.title);
    }
    return { ...row, done };
  });
}

function normalizeReminders(value, fallbackToDefaults = false) {
  if (value === undefined) {
    return fallbackToDefaults
      ? DEFAULT_REMINDER_OFFSETS.map((offsetMinutes) => ({ offsetMinutes }))
      : undefined;
  }
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => Number(typeof item === 'object' ? item.offsetMinutes : item))
    .filter((offset) => Number.isFinite(offset) && offset >= 0))]
    .sort((a, b) => b - a)
    .map((offsetMinutes) => ({ offsetMinutes }));
}

const populateTask = (query) =>
  query
    .populate('assigneeId', 'name email jobTitle department status')
    .populate('assignees', 'name email jobTitle department status')
    .populate('assignedBy', 'name email')
    .populate('projectId', 'name status')
    .populate('milestoneId', 'title status dueDate');

function normalizeAssignees(body) {
  if (Array.isArray(body.assignees) && body.assignees.length > 0) {
    return body.assignees.filter(Boolean);
  }
  if (body.assigneeId) return [body.assigneeId];
  return [];
}

async function resolveLinkedProjectId(req, projectId) {
  if (projectId === undefined) return undefined;
  if (projectId === null || projectId === '' || projectId === 'none') return null;
  const project = await Project.findOne(buildListQuery(req, { _id: projectId })).select('_id');
  if (!project) {
    const err = new Error('Invalid project');
    err.statusCode = 400;
    throw err;
  }
  return project._id;
}

async function resolveLinkedMilestoneId(req, milestoneId, projectId) {
  if (milestoneId === undefined) return undefined;
  if (milestoneId === null || milestoneId === '' || milestoneId === 'none') return null;
  const query = buildListQuery(req, { _id: milestoneId });
  if (projectId) query.projectId = projectId;
  const milestone = await ProjectMilestone.findOne(query).select('_id projectId');
  if (!milestone) {
    const err = new Error('Invalid milestone');
    err.statusCode = 400;
    throw err;
  }
  return milestone._id;
}

const notifyOwnerTaskCompleted = async (ownerId, task, member, completionNote) => {
  try {
    await Notification.create({
      userId: ownerId,
      sentBy: 'system',
      type: 'task_completed',
      title: 'Task completed',
      body: `${member?.name || 'Team member'} completed "${task.title}"${completionNote ? `: ${completionNote}` : ''}`,
      icon: '/logo.png',
      data: {
        taskId: task._id,
        assigneeId: task.assigneeId,
        department: task.department,
      },
      read: false,
    });
  } catch (error) {
    console.error('Failed to create task completion notification:', error);
  }
};

function buildLoginAwareUrl(path) {
  const baseUrl = getFrontendBaseUrl().replace(/\/$/, '');
  const safePath =
    typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
      ? path
      : '/';
  return `${baseUrl}/login?redirect=${encodeURIComponent(safePath)}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function notifyAssigneesOfTaskAssignment(task, members, assignerName) {
  const taskUrl = buildLoginAwareUrl(`/team/tasks?task=${encodeURIComponent(String(task._id))}`);
  const priorityLabel = task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Medium';
  const dueDateLabel = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No deadline';

  for (const member of members) {
    try {
      if (member.linkedUserId) {
        await Notification.create({
          userId: member.linkedUserId,
          sentBy: 'system',
          type: 'task_assigned',
          title: 'New task assigned to you',
          body: `${assignerName} assigned you "${task.title}"`,
          icon: '/logo.png',
          data: {
            taskId: task._id,
            department: task.department,
            route: `/team/tasks?task=${encodeURIComponent(String(task._id))}`,
            href: `/team/tasks?task=${encodeURIComponent(String(task._id))}`,
          },
          read: false,
        });
      }

      const recipientEmail = member.email;
      if (!recipientEmail) continue;

      const greetingName = member.name ? escapeHtml(member.name.split(' ')[0]) : 'Team member';
      const paragraphs = [
        `<strong>${escapeHtml(assignerName)}</strong> has assigned you a new task on Trippo.`,
        `<strong>Task:</strong> ${escapeHtml(task.title)}`,
        task.description
          ? `<strong>Description:</strong> ${escapeHtml(task.description)}`
          : null,
        `<strong>Priority:</strong> ${escapeHtml(priorityLabel)} &nbsp;&bull;&nbsp; <strong>Due:</strong> ${escapeHtml(dueDateLabel)}`,
      ].filter(Boolean);

      const html = renderEmailTemplate({
        eyebrow: 'TASK ASSIGNMENT',
        title: 'You have been assigned a new task',
        greeting: `Dear ${greetingName},`,
        paragraphs,
        actionUrl: taskUrl,
        actionText: 'Open task in Trippo',
        closing: 'Best regards,',
      });

      const text = `Dear ${member.name || 'Team member'},\n\n${assignerName} assigned you a task: "${task.title}"\nPriority: ${priorityLabel}\nDue: ${dueDateLabel}\n\nOpen it here: ${taskUrl}\n\nBest regards,\nTrippo`;

      await sendEmail({
        to: recipientEmail,
        subject: `New task assigned: ${task.title}`,
        text,
        html,
        fromName: 'Trippo Tasks',
      });
    } catch (error) {
      console.error(`Failed to notify assignee ${member._id}:`, error);
    }
  }
}

export const getTeamTasks = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const { status, department, assigneeId, monthKey, projectId } = req.query;
    const query = buildListQuery(req);
    if (status) query.status = status;
    if (department) query.department = department;
    if (assigneeId) {
      query.$or = [{ assigneeId }, { assignees: assigneeId }];
    }
    if (monthKey) query.monthKey = monthKey;
    if (projectId === 'none') {
      query.projectId = null;
    } else if (projectId) {
      query.projectId = projectId;
    }

    const tasks = await populateTask(TeamTask.find(query)).sort({
      status: 1,
      dueDate: 1,
      createdAt: -1,
    });

    res.json({ data: tasks });
  } catch (error) {
    console.error('Error fetching team tasks:', error);
    handleScopeError(res, error);
  }
};

export const getTeamTaskSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const { monthKey, department } = req.query;
    const match = buildListQuery(req);
    if (monthKey) match.monthKey = monthKey;
    if (department) match.department = department;

    const [statusCounts, memberStats, recentDone] = await Promise.all([
      TeamTask.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      TeamTask.aggregate([
        { $match: match },
        {
          $project: {
            status: 1,
            member: {
              $cond: {
                if: { $gt: [{ $size: { $ifNull: ['$assignees', []] } }, 0] },
                then: '$assignees',
                else: { $cond: { if: '$assigneeId', then: ['$assigneeId'], else: [] } },
              },
            },
          },
        },
        { $unwind: '$member' },
        {
          $group: {
            _id: '$member',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
            inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
            todo: { $sum: { $cond: [{ $eq: ['$status', 'todo'] }, 1, 0] } },
          },
        },
      ]),
      TeamTask.find({ ...match, status: 'done' })
        .populate('assigneeId', 'name')
        .sort({ completedAt: -1 })
        .limit(8)
        .lean(),
    ]);

    const members = await TeamMember.find(buildListQuery(req, { status: 'active' }))
      .select('_id name department jobTitle')
      .lean();
    const memberMap = new Map(members.map((m) => [String(m._id), m]));

    const byStatus = { todo: 0, in_progress: 0, done: 0 };
    for (const row of statusCounts) {
      if (row._id in byStatus) byStatus[row._id] = row.count;
    }

    const total = byStatus.todo + byStatus.in_progress + byStatus.done;
    const byMember = memberStats.map((row) => ({
      assigneeId: row._id,
      member: memberMap.get(String(row._id)) || null,
      total: row.total,
      done: row.done,
      inProgress: row.inProgress,
      todo: row.todo,
      progress: row.total ? Math.round((row.done / row.total) * 100) : 0,
    }));

    res.json({
      data: {
        total,
        byStatus,
        completionRate: total ? Math.round((byStatus.done / total) * 100) : 0,
        byMember,
        recentDone,
        activeMembers: members.length,
      },
    });
  } catch (error) {
    console.error('Error fetching team task summary:', error);
    handleScopeError(res, error);
  }
};

export const getTeamTask = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const task = await populateTask(
      TeamTask.findOne(buildListQuery(req, { _id: req.params.id })),
    );
    if (!task) return res.status(404).json({ error: 'Task not found' });

    res.json({ data: task });
  } catch (error) {
    console.error('Error fetching team task:', error);
    handleScopeError(res, error);
  }
};

export const createTeamTask = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const {
      title,
      description,
      department,
      status,
      priority,
      dueDate,
      reminders,
      monthKey,
      projectId,
      milestoneId,
      subtasks,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'Task title is required' });

    const assigneesList = normalizeAssignees(req.body);
    if (assigneesList.length === 0) return res.status(400).json({ error: 'At least one assignee is required' });

    const members = await TeamMember.find(buildListQuery(req, { _id: { $in: assigneesList } }));
    if (members.length !== assigneesList.length) {
      return res.status(400).json({ error: 'One or more invalid team members' });
    }
    const primaryAssigneeId = assigneesList[0];
    const member = members[0];

    let linkedProjectId = null;
    let linkedMilestoneId = null;
    try {
      linkedProjectId = await resolveLinkedProjectId(req, projectId);
      if (linkedProjectId === undefined) linkedProjectId = null;
      linkedMilestoneId = await resolveLinkedMilestoneId(req, milestoneId, linkedProjectId);
      if (linkedMilestoneId === undefined) linkedMilestoneId = null;
      if (linkedMilestoneId && !linkedProjectId) {
        return res.status(400).json({ error: 'A project is required when linking a milestone' });
      }
    } catch (resolveError) {
      return res.status(400).json({ error: resolveError.message || 'Invalid project or milestone' });
    }

    const scope = buildCreateScope(req);
    const initialStatus = status || 'todo';
    const task = await TeamTask.create({
      ...scope,
      assigneeId: primaryAssigneeId,
      assignees: assigneesList,
      assignedBy: scope.userId,
      title: title.trim(),
      description: description?.trim() || '',
      department: department || member.department || 'general',
      status: initialStatus,
      priority: priority || 'medium',
      dueDate: dueDate ? new Date(dueDate) : undefined,
      reminders: normalizeReminders(reminders, Boolean(dueDate)),
      monthKey: monthKey || undefined,
      projectId: linkedProjectId,
      milestoneId: linkedMilestoneId,
      subtasks: normalizeSubtasks(subtasks),
      ...initialTaskActivityFields(initialStatus),
    });

    const populated = await populateTask(TeamTask.findById(task._id));
    await broadcastScopeChange(req, 'team-task:created', populated);

    const assignerName = req.user?.name || 'A workspace admin';
    void notifyAssigneesOfTaskAssignment(task, members, assignerName);

    res.status(201).json({ data: populated });
  } catch (error) {
    console.error('Error creating team task:', error);
    handleScopeError(res, error);
  }
};

export const updateTeamTask = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const task = await TeamTask.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const prevStatus = task.status;
    const nextStatus = req.body.status;
    const statusChanging =
      nextStatus !== undefined && String(nextStatus).trim() !== String(prevStatus);

    if (statusChanging) {
      await assertCurrentUserIsAssignee(req, task);
    }

    const fields = [
      'title',
      'description',
      'assignees',
      'assigneeId',
      'department',
      'status',
      'priority',
      'dueDate',
      'reminders',
      'monthKey',
      'completionNote',
      'sortOrder',
      'projectId',
      'milestoneId',
      'subtasks',
    ];

    // Done tasks are locked: only status (reopen) or completion note may change.
    if (prevStatus === 'done') {
      const allowedWhileDone = new Set(['status', 'completionNote']);
      const attempted = fields.filter((field) => req.body[field] !== undefined);
      const disallowed = attempted.filter((field) => !allowedWhileDone.has(field));
      if (disallowed.length > 0) {
        return res.status(400).json({
          error:
            'Completed tasks cannot be edited. Move the task back to To do or In progress first.',
        });
      }
      if (req.body.completionNote !== undefined && !statusChanging) {
        await assertCurrentUserIsAssignee(req, task);
      }
    }

    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'dueDate') {
        task.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
        if (
          req.body.reminders === undefined &&
          req.body.dueDate &&
          (!Array.isArray(task.reminders) || task.reminders.length === 0)
        ) {
          task.reminders = normalizeReminders(undefined, true);
        }
      } else if (field === 'reminders') {
        task.reminders = normalizeReminders(req.body.reminders) || [];
      } else if (field === 'assignees') {
        if (Array.isArray(req.body.assignees)) {
          const ids = req.body.assignees.filter(Boolean);
          if (ids.length === 0) return res.status(400).json({ error: 'At least one assignee is required' });
          const members = await TeamMember.find(buildListQuery(req, { _id: { $in: ids } }));
          if (members.length !== ids.length) return res.status(400).json({ error: 'One or more invalid team members' });

          const prevIds = new Set((task.assignees || []).map(String));
          const newMembers = members.filter((m) => !prevIds.has(String(m._id)));
          if (newMembers.length > 0) {
            const assignerName = req.user?.name || 'A workspace admin';
            void notifyAssigneesOfTaskAssignment(task, newMembers, assignerName);
          }

          task.assignees = ids;
          task.assigneeId = ids[0];
        }
      } else if (field === 'assigneeId') {
        if (!req.body.assignees) {
          const member = await TeamMember.findOne(buildListQuery(req, { _id: req.body.assigneeId }));
          if (!member) return res.status(400).json({ error: 'Invalid team member' });
          task.assigneeId = req.body.assigneeId;
          task.assignees = [req.body.assigneeId];
        }
      } else if (field === 'projectId') {
        try {
          task.projectId = await resolveLinkedProjectId(req, req.body.projectId);
          if (!task.projectId) task.milestoneId = null;
        } catch (resolveError) {
          return res.status(400).json({ error: resolveError.message || 'Invalid project' });
        }
      } else if (field === 'milestoneId') {
        try {
          const projectRef = task.projectId || req.body.projectId || null;
          task.milestoneId = await resolveLinkedMilestoneId(req, req.body.milestoneId, projectRef);
        } catch (resolveError) {
          return res.status(400).json({ error: resolveError.message || 'Invalid milestone' });
        }
      } else if (field === 'subtasks') {
        const existing = Array.isArray(task.subtasks) ? task.subtasks : [];
        const next = normalizeSubtasks(req.body.subtasks);
        const structureChanged = hasSubtaskStructureChanged(existing, next);
        const doneChanged = hasSubtaskDoneChanged(existing, next);
        if (doneChanged) {
          try {
            await assertCurrentUserIsAssignee(
              req,
              task,
              'Only an assigned team member can mark subtasks complete',
            );
          } catch (accessError) {
            return res.status(accessError.statusCode || 403).json({
              error: accessError.message,
            });
          }
          task.subtasks = next;
        } else if (structureChanged) {
          task.subtasks = applySubtasksKeepingDone(existing, next);
        } else {
          task.subtasks = next;
        }
      } else if (typeof req.body[field] === 'string') {
        task[field] = req.body[field].trim();
      } else {
        task[field] = req.body[field];
      }
    }

    if (task.status === 'done' && prevStatus !== 'done') {
      task.completedAt = new Date();
      const member = await TeamMember.findById(task.assigneeId);
      await notifyOwnerTaskCompleted(req.user._id, task, member, task.completionNote);
    } else if (task.status !== 'done') {
      task.completedAt = null;
    }

    if (statusChanging) {
      applyTaskStatusActivity(task, prevStatus);
    } else {
      applyTaskProgressTouch(task, prevStatus, statusChanging);
    }

    await task.save();
    const populated = await populateTask(TeamTask.findById(task._id));
    await broadcastScopeChange(req, 'team-task:updated', populated);
    res.json({ data: populated });
  } catch (error) {
    console.error('Error updating team task:', error);
    handleScopeError(res, error);
  }
};

export const completeTeamTask = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const task = await TeamTask.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!task) return res.status(404).json({ error: 'Task not found' });

    await assertCurrentUserIsAssignee(req, task);

    const { completionNote } = req.body;
    const wasDone = task.status === 'done';
    const prevStatus = task.status;

    task.status = 'done';
    task.completionNote = completionNote?.trim() || task.completionNote || '';
    task.completedAt = new Date();
    if (!wasDone) {
      applyTaskStatusActivity(task, prevStatus);
    }

    await task.save();

    if (!wasDone) {
      const member = await TeamMember.findById(task.assigneeId);
      await notifyOwnerTaskCompleted(req.user._id, task, member, task.completionNote);
    }

    const populated = await populateTask(TeamTask.findById(task._id));
    await broadcastScopeChange(req, 'team-task:updated', populated);
    res.json({ data: populated });
  } catch (error) {
    console.error('Error completing team task:', error);
    handleScopeError(res, error);
  }
};

export const deleteTeamTask = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const task = await TeamTask.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!task) return res.status(404).json({ error: 'Task not found' });

    await broadcastScopeChange(req, 'team-task:deleted', {
      _id: task._id,
      workspaceId: task.workspaceId,
    });
    res.json({ message: 'Task deleted', data: task });
  } catch (error) {
    console.error('Error deleting team task:', error);
    handleScopeError(res, error);
  }
};
