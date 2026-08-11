import CalendarEvent from '../models/CalendarEvent.js';
import Schedule from '../models/Schedule.js';
import LeaveRequest from '../models/LeaveRequest.js';
import ProjectMilestone from '../models/ProjectMilestone.js';
import Project from '../models/Project.js';
import CompanyAnnouncement from '../models/CompanyAnnouncement.js';
import { buildListQuery, buildCreateScope, assertPageAccess, buildActorFields } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { canAccessWorkspacePage, canReviewLeaveRequests } from '../constants/workspacePermissions.js';

const ANNOUNCEMENT_SCOPES = ['workspace', 'regional', 'global'];
const ANNOUNCEMENT_PRIORITIES = ['normal', 'high', 'critical'];
const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived'];
const REGION_CODES = ['', 'Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];

function parseDateRange(start, end) {
  const range = {};
  if (start) {
    const startDate = new Date(start);
    if (!Number.isNaN(startDate.getTime())) range.$gte = startDate;
  }
  if (end) {
    const endDate = new Date(end);
    if (!Number.isNaN(endDate.getTime())) range.$lte = endDate;
  }
  return Object.keys(range).length ? range : null;
}

function overlapsRange(itemStart, itemEnd, rangeStart, rangeEnd) {
  const start = new Date(itemStart);
  const end = new Date(itemEnd || itemStart);
  if (Number.isNaN(start.getTime())) return false;
  return start <= rangeEnd && end >= rangeStart;
}

function hasPageAccess(req, pageKey) {
  const scope = req.dataScope;
  if (!scope || scope.mode !== 'workspace') return true;
  return canAccessWorkspacePage(scope.role, scope.permissions, pageKey);
}

function canManageAnnouncements(req) {
  const scope = req.dataScope;
  if (!scope || scope.mode !== 'workspace') return false;
  return scope.role === 'owner' || scope.role === 'admin';
}

function normalizeAnnouncement(record) {
  const plain = record.toObject ? record.toObject() : record;
  return { ...plain, id: String(plain._id) };
}

function feedItem({ id, feedType, title, startDate, endDate, allDay, subtitle, link, color, meta }) {
  return {
    id,
    feedType,
    title,
    startDate,
    endDate: endDate || undefined,
    allDay: Boolean(allDay),
    subtitle: subtitle || undefined,
    link: link || undefined,
    color: color || undefined,
    meta: meta || undefined,
  };
}

export const getCorporateCalendarSummary = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    const scope = buildListQuery(req);
    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);

    const canSeeLeave = hasPageAccess(req, 'team');
    const canSeeProjects = hasPageAccess(req, 'projects');

    const queries = [
      CalendarEvent.countDocuments({
        ...scope,
        status: { $ne: 'cancelled' },
        startDate: { $gte: now, $lte: weekAhead },
      }),
      CompanyAnnouncement.countDocuments({
        ...scope,
        status: 'published',
        startDate: { $lte: weekAhead },
        $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: now } }],
      }),
      Schedule.countDocuments({ ...scope, status: 'pending', dueDate: { $gte: now, $lte: weekAhead } }),
    ];

    if (canSeeLeave) {
      queries.push(
        LeaveRequest.countDocuments({
          ...scope,
          status: 'approved',
          startDate: { $lte: weekAhead },
          endDate: { $gte: now },
        }),
      );
    }

    if (canSeeProjects) {
      queries.push(
        ProjectMilestone.countDocuments({
          ...scope,
          status: { $ne: 'completed' },
          dueDate: { $gte: now, $lte: weekAhead },
        }),
      );
    }

    const results = await Promise.all(queries);
    let index = 0;
    const upcomingMeetings = results[index++];
    const activeAnnouncements = results[index++];
    const pendingAutomations = results[index++];
    const approvedLeaveWindows = canSeeLeave ? results[index++] : 0;
    const upcomingMilestones = canSeeProjects ? results[index++] : 0;

    res.json({
      data: {
        upcomingMeetings,
        activeAnnouncements,
        pendingAutomations,
        approvedLeaveWindows,
        upcomingMilestones,
      },
    });
  } catch (error) {
    console.error('Error fetching corporate calendar summary:', error);
    handleScopeError(res, error);
  }
};

export const getCorporateCalendarFeed = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    const { start, end } = req.query;
    const rangeStart = start ? new Date(start) : new Date();
    const rangeEnd = end ? new Date(end) : new Date(rangeStart.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    const scope = buildListQuery(req);
    const items = [];
    const canSeeLeave = hasPageAccess(req, 'team');
    const canSeeProjects = hasPageAccess(req, 'projects');

    const announcements = await CompanyAnnouncement.find({
      ...scope,
      status: 'published',
      startDate: { $lte: rangeEnd },
      $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: rangeStart } }],
    }).sort({ startDate: 1 });

    for (const row of announcements) {
      if (!overlapsRange(row.startDate, row.endDate || row.startDate, rangeStart, rangeEnd)) continue;
      items.push(
        feedItem({
          id: `announcement-${row._id}`,
          feedType: 'announcement',
          title: row.title,
          startDate: row.startDate,
          endDate: row.endDate || row.startDate,
          allDay: row.allDay,
          subtitle: row.scope === 'global' ? 'Company-wide' : row.scope === 'regional' ? row.regionCode || 'Regional' : 'Workspace',
          link: '/calendar/announcements',
          color: row.priority === 'critical' ? '#b91c1c' : row.priority === 'high' ? '#c2410c' : '#7c3aed',
          meta: { priority: row.priority, scope: row.scope, regionCode: row.regionCode },
        }),
      );
    }

    if (canSeeLeave) {
      const leaveQuery = {
        ...scope,
        status: { $in: ['approved'] },
        startDate: { $lte: rangeEnd },
        endDate: { $gte: rangeStart },
      };

      const canReviewLeave = canReviewLeaveRequests(req.dataScope?.role, req.dataScope?.permissions);
      if (!canReviewLeave) {
        leaveQuery.$or = [
          { requesterUserId: req.user._id },
          { isPublic: true },
        ];
      }

      const leaves = await LeaveRequest.find(leaveQuery).sort({ startDate: 1 });
      for (const row of leaves) {
        items.push(
          feedItem({
            id: `leave-${row._id}`,
            feedType: 'leave',
            title: `${row.requesterName} — ${row.leaveType} leave`,
            startDate: row.startDate,
            endDate: row.endDate,
            allDay: true,
            subtitle: row.status,
            link: '/hr/leave',
            color: '#0d9488',
            meta: { leaveType: row.leaveType, requesterName: row.requesterName },
          }),
        );
      }
    }

    if (canSeeProjects) {
      const milestones = await ProjectMilestone.find({
        ...scope,
        status: { $ne: 'completed' },
        dueDate: { $gte: rangeStart, $lte: rangeEnd },
      }).sort({ dueDate: 1 });

      const projectIds = [...new Set(milestones.map((m) => String(m.projectId)))];
      const projects = projectIds.length
        ? await Project.find({ ...scope, _id: { $in: projectIds } }).select('name title').lean()
        : [];
      const projectNames = new Map(projects.map((p) => [String(p._id), p.name || p.title || 'Project']));

      for (const row of milestones) {
        const projectName = projectNames.get(String(row.projectId)) || 'Project';
        items.push(
          feedItem({
            id: `milestone-${row._id}`,
            feedType: 'milestone',
            title: row.title,
            startDate: row.dueDate,
            allDay: true,
            subtitle: projectName,
            link: `/projects/${row.projectId}`,
            color: '#dc2626',
            meta: { projectId: String(row.projectId), status: row.status },
          }),
        );
      }
    }

    res.json({ data: items });
  } catch (error) {
    console.error('Error fetching corporate calendar feed:', error);
    handleScopeError(res, error);
  }
};

export const getCompanyAnnouncements = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    const { status } = req.query;
    const query = buildListQuery(req);
    if (ANNOUNCEMENT_STATUSES.includes(status)) query.status = status;

    // Members can view published announcements only; admins/owners see all statuses.
    if (!canManageAnnouncements(req)) {
      query.status = 'published';
    }

    const rows = await CompanyAnnouncement.find(query).sort({ startDate: -1, createdAt: -1 });
    res.json({ data: rows.map(normalizeAnnouncement) });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    handleScopeError(res, error);
  }
};

export const createCompanyAnnouncement = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    if (!canManageAnnouncements(req)) {
      return res.status(403).json({ error: 'Only workspace owners and admins can create announcements' });
    }
    const {
      title,
      body,
      startDate,
      endDate,
      allDay,
      scope,
      regionCode,
      priority,
      status,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: 'Announcement title is required' });
    }
    if (!startDate) {
      return res.status(400).json({ error: 'Start date is required' });
    }

    const announcementScope = ANNOUNCEMENT_SCOPES.includes(scope) ? scope : 'workspace';

    const row = await CompanyAnnouncement.create({
      title: title.trim(),
      body: body?.trim() || '',
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      allDay: allDay !== false,
      scope: announcementScope,
      regionCode: REGION_CODES.includes(regionCode) ? regionCode : '',
      priority: ANNOUNCEMENT_PRIORITIES.includes(priority) ? priority : 'normal',
      status: ANNOUNCEMENT_STATUSES.includes(status) ? status : 'draft',
      ...buildCreateScope(req),
      ...buildActorFields(req),
    });

    res.status(201).json({ data: normalizeAnnouncement(row) });
  } catch (error) {
    console.error('Error creating announcement:', error);
    handleScopeError(res, error);
  }
};

export const updateCompanyAnnouncement = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    if (!canManageAnnouncements(req)) {
      return res.status(403).json({ error: 'Only workspace owners and admins can update announcements' });
    }
    const row = await CompanyAnnouncement.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!row) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const fields = ['title', 'body', 'startDate', 'endDate', 'allDay', 'scope', 'regionCode', 'priority', 'status'];
    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'startDate' || field === 'endDate') {
        row[field] = req.body[field] ? new Date(req.body[field]) : null;
      } else if (field === 'allDay') {
        row.allDay = Boolean(req.body.allDay);
      } else if (field === 'scope') {
        row.scope = ANNOUNCEMENT_SCOPES.includes(req.body.scope) ? req.body.scope : row.scope;
      } else if (field === 'regionCode') {
        row.regionCode = REGION_CODES.includes(req.body.regionCode) ? req.body.regionCode : row.regionCode;
      } else if (field === 'priority') {
        row.priority = ANNOUNCEMENT_PRIORITIES.includes(req.body.priority) ? req.body.priority : row.priority;
      } else if (field === 'status') {
        row.status = ANNOUNCEMENT_STATUSES.includes(req.body.status) ? req.body.status : row.status;
      } else if (typeof req.body[field] === 'string') {
        row[field] = req.body[field].trim();
      } else {
        row[field] = req.body[field];
      }
    }

    await row.save();
    res.json({ data: normalizeAnnouncement(row) });
  } catch (error) {
    console.error('Error updating announcement:', error);
    handleScopeError(res, error);
  }
};

export const deleteCompanyAnnouncement = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    if (!canManageAnnouncements(req)) {
      return res.status(403).json({ error: 'Only workspace owners and admins can delete announcements' });
    }
    const row = await CompanyAnnouncement.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!row) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    res.json({ message: 'Announcement deleted', data: normalizeAnnouncement(row) });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    handleScopeError(res, error);
  }
};
