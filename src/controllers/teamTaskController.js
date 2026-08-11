import TeamTask from '../models/TeamTask.js';
import TeamMember from '../models/TeamMember.js';
import Notification from '../models/Notification.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { broadcastScopeChange } from '../utils/workspaceRealtime.js';
import { assertCurrentUserIsAssignee } from '../utils/taskAssigneeAccess.js';

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

export const getTeamTasks = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const { status, department, assigneeId, monthKey } = req.query;
    const query = buildListQuery(req);
    if (status) query.status = status;
    if (department) query.department = department;
    if (assigneeId) query.assigneeId = assigneeId;
    if (monthKey) query.monthKey = monthKey;

    const tasks = await TeamTask.find(query)
      .populate('assigneeId', 'name email jobTitle department status')
      .sort({ status: 1, dueDate: 1, createdAt: -1 });

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
          $group: {
            _id: '$assigneeId',
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
    const task = await TeamTask.findOne(buildListQuery(req, { _id: req.params.id })).populate(
      'assigneeId',
      'name email jobTitle department',
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
      assigneeId,
      department,
      status,
      priority,
      dueDate,
      monthKey,
    } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'Task title is required' });
    if (!assigneeId) return res.status(400).json({ error: 'Assignee is required' });

    const member = await TeamMember.findOne(buildListQuery(req, { _id: assigneeId }));
    if (!member) return res.status(400).json({ error: 'Invalid team member' });

    const scope = buildCreateScope(req);
    const task = await TeamTask.create({
      ...scope,
      assigneeId,
      assignedBy: scope.userId,
      title: title.trim(),
      description: description?.trim() || '',
      department: department || member.department || 'general',
      status: status || 'todo',
      priority: priority || 'medium',
      dueDate: dueDate ? new Date(dueDate) : undefined,
      monthKey: monthKey || undefined,
    });

    const populated = await TeamTask.findById(task._id).populate('assigneeId', 'name email jobTitle department');
    await broadcastScopeChange(req, 'team-task:created', populated);
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
      await assertCurrentUserIsAssignee(req, task.assigneeId);
    }

    const fields = [
      'title',
      'description',
      'assigneeId',
      'department',
      'status',
      'priority',
      'dueDate',
      'monthKey',
      'completionNote',
      'sortOrder',
    ];

    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'dueDate') {
        task.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
      } else if (field === 'assigneeId') {
        const member = await TeamMember.findOne(buildListQuery(req, { _id: req.body.assigneeId }));
        if (!member) return res.status(400).json({ error: 'Invalid team member' });
        task.assigneeId = req.body.assigneeId;
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

    await task.save();
    const populated = await TeamTask.findById(task._id).populate('assigneeId', 'name email jobTitle department');
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

    await assertCurrentUserIsAssignee(req, task.assigneeId);

    const { completionNote } = req.body;
    const wasDone = task.status === 'done';

    task.status = 'done';
    task.completionNote = completionNote?.trim() || task.completionNote || '';
    task.completedAt = new Date();

    await task.save();

    if (!wasDone) {
      const member = await TeamMember.findById(task.assigneeId);
      await notifyOwnerTaskCompleted(req.user._id, task, member, task.completionNote);
    }

    const populated = await TeamTask.findById(task._id).populate('assigneeId', 'name email jobTitle department');
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
