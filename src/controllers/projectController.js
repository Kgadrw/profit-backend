import Project from '../models/Project.js';
import ProjectMilestone from '../models/ProjectMilestone.js';
import ProjectTask from '../models/ProjectTask.js';
import ProjectMember from '../models/ProjectMember.js';
import TimeEntry from '../models/TimeEntry.js';
import TeamMember from '../models/TeamMember.js';
import mongoose from 'mongoose';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { assertCurrentUserIsAssignee } from '../utils/taskAssigneeAccess.js';

const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed'];

function normalizeDate(value) {
  if (!value) return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00`);
  }
  return new Date(value);
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekLabel(date) {
  const start = startOfWeek(date);
  return start.toISOString().slice(0, 10);
}

function buildWeeklySeries(rows, dateField, valueField, weeks = 4) {
  const now = new Date();
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = startOfWeek(now);
    start.setDate(start.getDate() - i * 7);
    buckets.push({ weekStart: weekLabel(start), value: 0 });
  }

  for (const row of rows) {
    const raw = row[dateField];
    if (!raw) continue;
    const key = weekLabel(new Date(raw));
    const bucket = buckets.find((b) => b.weekStart === key);
    if (bucket) {
      bucket.value += valueField ? Number(row[valueField] || 0) : 1;
    }
  }

  return buckets.map((b) => ({
    weekStart: b.weekStart,
    value: Math.round(b.value * 100) / 100,
  }));
}

function dayKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** GitHub-style daily contribution buckets for the last `days` calendar days. */
function buildDailyContributionSeries(taskRows, timeRows, days = 371) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const map = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = dayKey(d);
    map.set(key, { date: key, hours: 0, tasks: 0, count: 0 });
  }

  for (const row of timeRows || []) {
    const key = dayKey(row.date);
    if (!key || !map.has(key)) continue;
    const bucket = map.get(key);
    const hours = Number(row.hours || 0);
    bucket.hours += hours;
    if (hours > 0) bucket.count += 1;
  }

  for (const row of taskRows || []) {
    const key = dayKey(row.completedAt);
    if (!key || !map.has(key)) continue;
    const bucket = map.get(key);
    bucket.tasks += 1;
    bucket.count += 1;
  }

  return [...map.values()].map((bucket) => {
    const hours = Math.round(bucket.hours * 100) / 100;
    const intensity = hours * 2 + bucket.tasks;
    let level = 0;
    if (intensity > 0 && intensity < 1) level = 1;
    else if (intensity >= 1 && intensity < 3) level = 2;
    else if (intensity >= 3 && intensity < 6) level = 3;
    else if (intensity >= 6) level = 4;
    return {
      date: bucket.date,
      hours,
      tasks: bucket.tasks,
      count: bucket.count,
      level,
    };
  });
}

async function findProject(req, projectId) {
  return Project.findOne(buildListQuery(req, { _id: projectId }));
}

async function validateTeamMember(req, teamMemberId) {
  if (!teamMemberId) return null;
  return TeamMember.findOne(buildListQuery(req, { _id: teamMemberId }));
}

export const getProjects = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const { status } = req.query;
    const query = buildListQuery(req);
    if (PROJECT_STATUSES.includes(status)) query.status = status;

    const projects = await Project.find(query)
      .populate('leadMemberId', 'name email jobTitle department')
      .sort({ status: 1, updatedAt: -1 });

    res.json({ data: projects });
  } catch (error) {
    console.error('Error fetching projects:', error);
    handleScopeError(res, error);
  }
};

export const getProjectsSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const scope = buildListQuery(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const contributionProjectId = req.query.projectId;

    const [projects, overdueMilestones, openTasks, completedTasks, timeEntries, openTaskByProject] =
      await Promise.all([
        Project.find(scope)
          .populate('leadMemberId', 'name email jobTitle department')
          .select('name status priority startDate targetEndDate clientName leadMemberId updatedAt')
          .lean(),
        ProjectMilestone.countDocuments({
          ...scope,
          status: { $ne: 'completed' },
          dueDate: { $lt: today },
        }),
        ProjectTask.countDocuments({ ...scope, status: { $ne: 'done' } }),
        ProjectTask.find({ ...scope, status: 'done', completedAt: { $ne: null } })
          .select('completedAt projectId')
          .lean(),
        TimeEntry.find(scope).select('date hours projectId').lean(),
        ProjectTask.aggregate([
          { $match: { ...scope, status: { $ne: 'done' } } },
          { $group: { _id: '$projectId', count: { $sum: 1 } } },
        ]),
      ]);

    const byStatus = { planning: 0, active: 0, on_hold: 0, completed: 0, cancelled: 0 };
    for (const row of projects) {
      if (row.status in byStatus) byStatus[row.status] += 1;
    }

    const openTaskMap = new Map(
      openTaskByProject.map((row) => [String(row._id), row.count]),
    );

    const needsWorkStatuses = new Set(['planning', 'active', 'on_hold']);
    const workQueue = projects
      .filter((row) => needsWorkStatuses.has(row.status))
      .map((row) => ({
        _id: String(row._id),
        name: row.name,
        status: row.status,
        priority: row.priority || 'medium',
        startDate: row.startDate || null,
        targetEndDate: row.targetEndDate || null,
        clientName: row.clientName || '',
        leadName:
          row.leadMemberId && typeof row.leadMemberId === 'object'
            ? row.leadMemberId.name || ''
            : '',
        openTasks: openTaskMap.get(String(row._id)) || 0,
        updatedAt: row.updatedAt || null,
      }))
      .sort((a, b) => {
        const aEnd = a.targetEndDate ? new Date(a.targetEndDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bEnd = b.targetEndDate ? new Date(b.targetEndDate).getTime() : Number.MAX_SAFE_INTEGER;
        if (aEnd !== bEnd) return aEnd - bEnd;
        return String(a.name).localeCompare(String(b.name));
      });

    const activeProjectIds = workQueue.map((row) => row._id);
    let graphProjectId =
      contributionProjectId && activeProjectIds.includes(String(contributionProjectId))
        ? String(contributionProjectId)
        : workQueue[0]?._id || (projects[0] ? String(projects[0]._id) : null);

    if (contributionProjectId && mongoose.Types.ObjectId.isValid(contributionProjectId)) {
      const exists = projects.some((row) => String(row._id) === String(contributionProjectId));
      if (exists) graphProjectId = String(contributionProjectId);
    }

    const taskRowsForGraph = graphProjectId
      ? completedTasks.filter((row) => String(row.projectId) === graphProjectId)
      : completedTasks;
    const timeRowsForGraph = graphProjectId
      ? timeEntries.filter((row) => String(row.projectId) === graphProjectId)
      : timeEntries;

    const graphProject = projects.find((row) => String(row._id) === graphProjectId);

    res.json({
      data: {
        totalProjects: projects.length,
        byStatus,
        overdueMilestones,
        openTasks,
        tasksCompletedWeekly: buildWeeklySeries(completedTasks, 'completedAt'),
        hoursLoggedWeekly: buildWeeklySeries(timeEntries, 'date', 'hours'),
        workQueue,
        projectOptions: projects.map((row) => ({
          _id: String(row._id),
          name: row.name,
          status: row.status,
        })),
        contributionGraph: {
          projectId: graphProjectId,
          projectName: graphProject?.name || null,
          days: buildDailyContributionSeries(taskRowsForGraph, timeRowsForGraph),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching projects summary:', error);
    handleScopeError(res, error);
  }
};

export const getProject = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const project = await Project.findOne(buildListQuery(req, { _id: req.params.id })).populate(
      'leadMemberId',
      'name email jobTitle department',
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ data: project });
  } catch (error) {
    console.error('Error fetching project:', error);
    handleScopeError(res, error);
  }
};

export const getProjectProfile = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const project = await Project.findOne(buildListQuery(req, { _id: req.params.id })).populate(
      'leadMemberId',
      'name email jobTitle department',
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const scope = buildListQuery(req, { projectId: project._id });

    const [milestones, tasks, members, timeEntries] = await Promise.all([
      ProjectMilestone.find(scope).sort({ sortOrder: 1, dueDate: 1, createdAt: 1 }),
      ProjectTask.find(scope)
        .populate('assigneeId', 'name email jobTitle department')
        .sort({ sortOrder: 1, status: 1, dueDate: 1 }),
      // List by project only — project already passed scope check. Avoid hiding rows
      // that share projectId+teamMemberId but have a mismatched workspaceId/userId.
      ProjectMember.find({ projectId: project._id })
        .populate('teamMemberId', 'name email jobTitle department')
        .sort({ role: 1, createdAt: 1 }),
      TimeEntry.find(scope)
        .populate('teamMemberId', 'name jobTitle')
        .populate('projectTaskId', 'title')
        .sort({ date: -1 })
        .limit(50),
    ]);

    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.status === 'done').length;
    const totalMilestones = milestones.length;
    const doneMilestones = milestones.filter((m) => m.status === 'completed').length;
    const totalHours = timeEntries.reduce((sum, row) => sum + (row.hours || 0), 0);

    const completedTaskRows = tasks
      .filter((t) => t.status === 'done' && t.completedAt)
      .map((t) => ({ completedAt: t.completedAt }));

    res.json({
      data: {
        project,
        milestones,
        tasks,
        members,
        timeEntries,
        progress: {
          taskCompletionRate: totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0,
          milestoneCompletionRate: totalMilestones ? Math.round((doneMilestones / totalMilestones) * 100) : 0,
          totalTasks,
          doneTasks,
          totalMilestones,
          doneMilestones,
          totalHoursLogged: Math.round(totalHours * 100) / 100,
        },
        velocity: {
          tasksCompletedWeekly: buildWeeklySeries(completedTaskRows, 'completedAt'),
          hoursLoggedWeekly: buildWeeklySeries(timeEntries, 'date', 'hours'),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching project profile:', error);
    handleScopeError(res, error);
  }
};

export const createProject = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const { name, description, status, priority, startDate, targetEndDate, leadMemberId, clientName } =
      req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Project name is required' });

    if (leadMemberId) {
      const lead = await validateTeamMember(req, leadMemberId);
      if (!lead) return res.status(400).json({ error: 'Invalid project lead' });
    }

    const scope = buildCreateScope(req);
    const project = await Project.create({
      ...scope,
      name: name.trim(),
      description: description?.trim() || '',
      status: PROJECT_STATUSES.includes(status) ? status : 'planning',
      priority: priority || 'medium',
      startDate: normalizeDate(startDate),
      targetEndDate: normalizeDate(targetEndDate),
      leadMemberId: leadMemberId || null,
      clientName: clientName?.trim() || '',
    });

    if (leadMemberId) {
      try {
        await ProjectMember.create({
          ...scope,
          projectId: project._id,
          teamMemberId: leadMemberId,
          role: 'lead',
        });
      } catch (memberError) {
        // Project is already created — don't fail the whole request if lead membership upsert races.
        if (memberError?.code !== 11000) {
          console.error('Error adding project lead member:', memberError);
        }
      }
    }

    const populated = await Project.findById(project._id).populate(
      'leadMemberId',
      'name email jobTitle department',
    );
    res.status(201).json({ data: populated });
  } catch (error) {
    console.error('Error creating project:', error);
    handleScopeError(res, error);
  }
};

export const updateProject = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const project = await findProject(req, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const fields = [
      'name',
      'description',
      'status',
      'priority',
      'startDate',
      'targetEndDate',
      'leadMemberId',
      'clientName',
    ];

    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'startDate' || field === 'targetEndDate') {
        project[field] = normalizeDate(req.body[field]) || null;
      } else if (field === 'leadMemberId') {
        if (req.body.leadMemberId) {
          const lead = await validateTeamMember(req, req.body.leadMemberId);
          if (!lead) return res.status(400).json({ error: 'Invalid project lead' });
          project.leadMemberId = req.body.leadMemberId;
        } else {
          project.leadMemberId = null;
        }
      } else if (field === 'status') {
        if (!PROJECT_STATUSES.includes(req.body.status)) continue;
        project.status = req.body.status;
        if (req.body.status === 'completed') {
          project.completedAt = new Date();
        } else if (project.status !== 'completed') {
          project.completedAt = null;
        }
      } else if (typeof req.body[field] === 'string') {
        project[field] = req.body[field].trim();
      } else {
        project[field] = req.body[field];
      }
    }

    await project.save();

    if (req.body.leadMemberId) {
      const scope = buildCreateScope(req);
      const existingLead = await ProjectMember.findOne({
        projectId: project._id,
        teamMemberId: req.body.leadMemberId,
      });
      if (existingLead) {
        existingLead.role = 'lead';
        existingLead.workspaceId = scope.workspaceId ?? null;
        existingLead.userId = scope.userId;
        await existingLead.save();
      } else {
        try {
          await ProjectMember.create({
            ...scope,
            projectId: project._id,
            teamMemberId: req.body.leadMemberId,
            role: 'lead',
          });
        } catch (memberError) {
          if (memberError?.code !== 11000) {
            console.error('Error syncing project lead member:', memberError);
          }
        }
      }
    }

    const populated = await Project.findById(project._id).populate(
      'leadMemberId',
      'name email jobTitle department',
    );
    res.json({ data: populated });
  } catch (error) {
    console.error('Error updating project:', error);
    handleScopeError(res, error);
  }
};

export const deleteProject = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const project = await Project.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const scope = buildListQuery(req, { projectId: project._id });
    await Promise.all([
      ProjectMilestone.deleteMany(scope),
      ProjectTask.deleteMany(scope),
      ProjectMember.deleteMany(scope),
      TimeEntry.deleteMany(scope),
    ]);

    res.json({ message: 'Project deleted', data: project });
  } catch (error) {
    console.error('Error deleting project:', error);
    handleScopeError(res, error);
  }
};

export const createProjectMilestone = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const project = await findProject(req, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { title, description, status, dueDate, sortOrder } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Milestone title is required' });

    const scope = buildCreateScope(req);
    const milestone = await ProjectMilestone.create({
      ...scope,
      projectId: project._id,
      title: title.trim(),
      description: description?.trim() || '',
      status: MILESTONE_STATUSES.includes(status) ? status : 'pending',
      dueDate: normalizeDate(dueDate),
      sortOrder: sortOrder ?? 0,
      completedAt: status === 'completed' ? new Date() : undefined,
    });

    res.status(201).json({ data: milestone });
  } catch (error) {
    console.error('Error creating milestone:', error);
    handleScopeError(res, error);
  }
};

export const updateProjectMilestone = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const milestone = await ProjectMilestone.findOne(
      buildListQuery(req, { _id: req.params.id, projectId: req.params.projectId }),
    );
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });

    const fields = ['title', 'description', 'status', 'dueDate', 'sortOrder'];
    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'dueDate') {
        milestone.dueDate = normalizeDate(req.body.dueDate) || null;
      } else if (field === 'status') {
        if (!MILESTONE_STATUSES.includes(req.body.status)) continue;
        milestone.status = req.body.status;
        milestone.completedAt = req.body.status === 'completed' ? new Date() : null;
      } else if (typeof req.body[field] === 'string') {
        milestone[field] = req.body[field].trim();
      } else {
        milestone[field] = req.body[field];
      }
    }

    await milestone.save();
    res.json({ data: milestone });
  } catch (error) {
    console.error('Error updating milestone:', error);
    handleScopeError(res, error);
  }
};

export const deleteProjectMilestone = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const milestone = await ProjectMilestone.findOneAndDelete(
      buildListQuery(req, { _id: req.params.id, projectId: req.params.projectId }),
    );
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });

    await ProjectTask.updateMany(
      buildListQuery(req, { projectId: req.params.projectId, milestoneId: milestone._id }),
      { $set: { milestoneId: null } },
    );

    res.json({ message: 'Milestone deleted', data: milestone });
  } catch (error) {
    console.error('Error deleting milestone:', error);
    handleScopeError(res, error);
  }
};

export const createProjectTask = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const project = await findProject(req, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { title, description, milestoneId, assigneeId, status, priority, dueDate, estimatedHours, sortOrder } =
      req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Task title is required' });

    if (milestoneId) {
      const milestone = await ProjectMilestone.findOne(
        buildListQuery(req, { _id: milestoneId, projectId: project._id }),
      );
      if (!milestone) return res.status(400).json({ error: 'Invalid milestone' });
    }

    if (assigneeId) {
      const member = await validateTeamMember(req, assigneeId);
      if (!member) return res.status(400).json({ error: 'Invalid assignee' });
    }

    const scope = buildCreateScope(req);
    const task = await ProjectTask.create({
      ...scope,
      projectId: project._id,
      milestoneId: milestoneId || null,
      title: title.trim(),
      description: description?.trim() || '',
      assigneeId: assigneeId || null,
      status: TASK_STATUSES.includes(status) ? status : 'todo',
      priority: priority || 'medium',
      dueDate: normalizeDate(dueDate),
      estimatedHours: estimatedHours != null ? Number(estimatedHours) : undefined,
      sortOrder: sortOrder ?? 0,
      completedAt: status === 'done' ? new Date() : undefined,
    });

    const populated = await ProjectTask.findById(task._id).populate(
      'assigneeId',
      'name email jobTitle department',
    );
    res.status(201).json({ data: populated });
  } catch (error) {
    console.error('Error creating project task:', error);
    handleScopeError(res, error);
  }
};

export const updateProjectTask = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const task = await ProjectTask.findOne(
      buildListQuery(req, { _id: req.params.id, projectId: req.params.projectId }),
    );
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const prevStatus = task.status;
    const nextStatus = req.body.status;
    const statusChanging =
      nextStatus !== undefined &&
      TASK_STATUSES.includes(nextStatus) &&
      String(nextStatus) !== String(prevStatus);

    if (statusChanging) {
      await assertCurrentUserIsAssignee(req, task.assigneeId);
    }

    const fields = [
      'title',
      'description',
      'milestoneId',
      'assigneeId',
      'status',
      'priority',
      'dueDate',
      'estimatedHours',
      'sortOrder',
    ];

    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'dueDate') {
        task.dueDate = normalizeDate(req.body.dueDate) || null;
      } else if (field === 'milestoneId') {
        if (req.body.milestoneId) {
          const milestone = await ProjectMilestone.findOne(
            buildListQuery(req, { _id: req.body.milestoneId, projectId: req.params.projectId }),
          );
          if (!milestone) return res.status(400).json({ error: 'Invalid milestone' });
        }
        task.milestoneId = req.body.milestoneId || null;
      } else if (field === 'assigneeId') {
        if (req.body.assigneeId) {
          const member = await validateTeamMember(req, req.body.assigneeId);
          if (!member) return res.status(400).json({ error: 'Invalid assignee' });
        }
        task.assigneeId = req.body.assigneeId || null;
      } else if (field === 'status') {
        if (!TASK_STATUSES.includes(req.body.status)) continue;
        task.status = req.body.status;
      } else if (typeof req.body[field] === 'string') {
        task[field] = req.body[field].trim();
      } else {
        task[field] = req.body[field];
      }
    }

    if (task.status === 'done' && prevStatus !== 'done') {
      task.completedAt = new Date();
    } else if (task.status !== 'done') {
      task.completedAt = null;
    }

    await task.save();
    const populated = await ProjectTask.findById(task._id).populate(
      'assigneeId',
      'name email jobTitle department',
    );
    res.json({ data: populated });
  } catch (error) {
    console.error('Error updating project task:', error);
    handleScopeError(res, error);
  }
};

export const deleteProjectTask = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const task = await ProjectTask.findOneAndDelete(
      buildListQuery(req, { _id: req.params.id, projectId: req.params.projectId }),
    );
    if (!task) return res.status(404).json({ error: 'Task not found' });

    await TimeEntry.updateMany(
      buildListQuery(req, { projectId: req.params.projectId, projectTaskId: task._id }),
      { $set: { projectTaskId: null } },
    );

    res.json({ message: 'Task deleted', data: task });
  } catch (error) {
    console.error('Error deleting project task:', error);
    handleScopeError(res, error);
  }
};

export const addProjectMember = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const project = await findProject(req, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { teamMemberId, role } = req.body;
    if (!teamMemberId) return res.status(400).json({ error: 'Team member is required' });

    const member = await validateTeamMember(req, teamMemberId);
    if (!member) return res.status(400).json({ error: 'Invalid team member' });

    const scope = buildCreateScope(req);
    const nextRole = ['lead', 'member', 'viewer'].includes(role) ? role : 'member';

    // Unique index is projectId+teamMemberId (not scoped). Find globally so we can
    // repair workspace/user scope and return the row instead of failing with "already on project"
    // while the profile list (scoped) stays empty.
    let projectMember = await ProjectMember.findOne({ projectId: project._id, teamMemberId });
    if (projectMember) {
      const scopeWs = scope.workspaceId ? String(scope.workspaceId) : '';
      const rowWs = projectMember.workspaceId ? String(projectMember.workspaceId) : '';
      const scopeUser = String(scope.userId);
      const rowUser = String(projectMember.userId || '');
      let dirty = false;
      if (scopeWs !== rowWs) {
        projectMember.workspaceId = scope.workspaceId ?? null;
        dirty = true;
      }
      if (scopeUser !== rowUser) {
        projectMember.userId = scope.userId;
        dirty = true;
      }
      if (role && projectMember.role !== nextRole) {
        projectMember.role = nextRole;
        dirty = true;
      }
      if (dirty) await projectMember.save();

      const populated = await ProjectMember.findById(projectMember._id).populate(
        'teamMemberId',
        'name email jobTitle department',
      );
      return res.status(200).json({ data: populated });
    }

    projectMember = await ProjectMember.create({
      ...scope,
      projectId: project._id,
      teamMemberId,
      role: nextRole,
    });

    const populated = await ProjectMember.findById(projectMember._id).populate(
      'teamMemberId',
      'name email jobTitle department',
    );
    res.status(201).json({ data: populated });
  } catch (error) {
    console.error('Error adding project member:', error);
    if (error?.code === 11000) {
      const existing = await ProjectMember.findOne({
        projectId: req.params.projectId,
        teamMemberId: req.body?.teamMemberId,
      }).populate('teamMemberId', 'name email jobTitle department');
      if (existing) return res.status(200).json({ data: existing });
      return res.status(400).json({ error: 'Member already on project' });
    }
    handleScopeError(res, error);
  }
};

export const removeProjectMember = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const projectMember = await ProjectMember.findOneAndDelete(
      buildListQuery(req, { _id: req.params.id, projectId: req.params.projectId }),
    );
    if (!projectMember) return res.status(404).json({ error: 'Project member not found' });
    res.json({ message: 'Member removed', data: projectMember });
  } catch (error) {
    console.error('Error removing project member:', error);
    handleScopeError(res, error);
  }
};

export const createTimeEntry = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const project = await findProject(req, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { teamMemberId, projectTaskId, date, hours, note, billable } = req.body;
    if (!teamMemberId) return res.status(400).json({ error: 'Team member is required' });
    if (!date) return res.status(400).json({ error: 'Date is required' });
    const parsedHours = Number(hours);
    if (!parsedHours || parsedHours <= 0) return res.status(400).json({ error: 'Valid hours are required' });

    const member = await validateTeamMember(req, teamMemberId);
    if (!member) return res.status(400).json({ error: 'Invalid team member' });

    if (projectTaskId) {
      const task = await ProjectTask.findOne(
        buildListQuery(req, { _id: projectTaskId, projectId: project._id }),
      );
      if (!task) return res.status(400).json({ error: 'Invalid project task' });
    }

    const scope = buildCreateScope(req);
    const entry = await TimeEntry.create({
      ...scope,
      projectId: project._id,
      projectTaskId: projectTaskId || null,
      teamMemberId,
      date: normalizeDate(date),
      hours: parsedHours,
      note: note?.trim() || '',
      billable: billable !== false,
    });

    const populated = await TimeEntry.findById(entry._id)
      .populate('teamMemberId', 'name jobTitle')
      .populate('projectTaskId', 'title');
    res.status(201).json({ data: populated });
  } catch (error) {
    console.error('Error creating time entry:', error);
    handleScopeError(res, error);
  }
};

export const deleteTimeEntry = async (req, res) => {
  try {
    assertPageAccess(req, 'projects');
    const entry = await TimeEntry.findOneAndDelete(
      buildListQuery(req, { _id: req.params.id, projectId: req.params.projectId }),
    );
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
    res.json({ message: 'Time entry deleted', data: entry });
  } catch (error) {
    console.error('Error deleting time entry:', error);
    handleScopeError(res, error);
  }
};
