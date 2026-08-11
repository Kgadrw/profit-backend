import mongoose from 'mongoose';
import TeamMember from '../models/TeamMember.js';
import LeaveRequest from '../models/LeaveRequest.js';
import Payroll from '../models/Payroll.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { syncTeamMembersFromWorkspace } from '../utils/syncTeamFromWorkspace.js';

const HR_STRING_FIELDS = [
  'name',
  'email',
  'phone',
  'jobTitle',
  'department',
  'status',
  'notes',
  'employeeNumber',
  'location',
  'emergencyContactName',
  'emergencyContactPhone',
  'employmentType',
];

const HR_NUMBER_FIELDS = ['annualLeaveAllowance', 'sickLeaveAllowance'];

const HR_DATE_FIELDS = ['hireDate', 'terminationDate'];

const HR_OBJECT_ID_FIELDS = ['reportsToId', 'linkedUserId'];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeDayCount(startDate, endDate) {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  const diff = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(diff / (24 * 60 * 60 * 1000)) + 1);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyTeamMemberFields(member, body) {
  for (const field of HR_STRING_FIELDS) {
    if (body[field] === undefined) continue;
    if (field === 'email' && body.email) {
      member.email = String(body.email).trim().toLowerCase();
    } else if (typeof body[field] === 'string') {
      member[field] = body[field].trim();
    } else {
      member[field] = body[field];
    }
  }

  for (const field of HR_NUMBER_FIELDS) {
    if (body[field] === undefined) continue;
    const parsed = Number(body[field]);
    member[field] = Number.isFinite(parsed) ? parsed : member[field];
  }

  for (const field of HR_DATE_FIELDS) {
    if (body[field] === undefined) continue;
    member[field] = body[field] ? new Date(body[field]) : null;
  }

  for (const field of HR_OBJECT_ID_FIELDS) {
    if (body[field] === undefined) continue;
    if (!body[field]) {
      member[field] = null;
      continue;
    }
    if (!mongoose.Types.ObjectId.isValid(body[field])) {
      const error = new Error(`Invalid ${field}`);
      error.statusCode = 400;
      throw error;
    }
    member[field] = body[field];
  }
}

function buildTeamMemberPayload(body) {
  const payload = {
    name: body.name?.trim(),
    email: body.email?.trim().toLowerCase() || '',
    phone: body.phone?.trim() || '',
    jobTitle: body.jobTitle?.trim() || '',
    department: body.department || 'general',
    status: body.status || 'active',
    notes: body.notes?.trim() || '',
    employeeNumber: body.employeeNumber?.trim() || '',
    location: body.location?.trim() || '',
    emergencyContactName: body.emergencyContactName?.trim() || '',
    emergencyContactPhone: body.emergencyContactPhone?.trim() || '',
    employmentType: body.employmentType || 'full_time',
  };

  if (body.hireDate) payload.hireDate = new Date(body.hireDate);
  if (body.terminationDate) payload.terminationDate = new Date(body.terminationDate);

  if (body.annualLeaveAllowance !== undefined) {
    payload.annualLeaveAllowance = Number(body.annualLeaveAllowance);
  }
  if (body.sickLeaveAllowance !== undefined) {
    payload.sickLeaveAllowance = Number(body.sickLeaveAllowance);
  }

  for (const field of HR_OBJECT_ID_FIELDS) {
    if (body[field] && mongoose.Types.ObjectId.isValid(body[field])) {
      payload[field] = body[field];
    }
  }

  return payload;
}

async function computeLeaveUsage(req, teamMemberId, leaveType, yearStart) {
  const leaves = await LeaveRequest.find({
    ...buildListQuery(req),
    teamMemberId,
    status: 'approved',
    leaveType,
    startDate: { $gte: yearStart },
  }).lean();

  return leaves.reduce((sum, leave) => sum + computeDayCount(leave.startDate, leave.endDate), 0);
}

export const getTeamMembers = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const { status, department } = req.query;
    const query = buildListQuery(req);
    if (status) query.status = status;
    if (department) query.department = department;

    const members = await TeamMember.find(query)
      .populate('reportsToId', 'name jobTitle')
      .sort({ name: 1 });
    res.json({ data: members });
  } catch (error) {
    console.error('Error fetching team members:', error);
    handleScopeError(res, error);
  }
};

export const getTeamMember = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const member = await TeamMember.findOne(buildListQuery(req, { _id: req.params.id }))
      .populate('reportsToId', 'name jobTitle department');
    if (!member) return res.status(404).json({ error: 'Team member not found' });

    res.json({ data: member });
  } catch (error) {
    console.error('Error fetching team member:', error);
    handleScopeError(res, error);
  }
};

export const getTeamMemberProfile = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const member = await TeamMember.findOne(buildListQuery(req, { _id: req.params.id }))
      .populate('reportsToId', 'name jobTitle department')
      .lean();
    if (!member) return res.status(404).json({ error: 'Team member not found' });

    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const annualAllowance = member.annualLeaveAllowance ?? 21;
    const sickAllowance = member.sickLeaveAllowance ?? 10;

    const [annualUsed, sickUsed, recentLeave, recentPayroll, directReports] = await Promise.all([
      computeLeaveUsage(req, member._id, 'annual', yearStart),
      computeLeaveUsage(req, member._id, 'sick', yearStart),
      LeaveRequest.find(buildListQuery(req, { teamMemberId: member._id }))
        .sort({ startDate: -1 })
        .limit(20)
        .lean(),
      Payroll.find({
        ...buildListQuery(req),
        $or: [
          { teamMemberId: member._id },
          {
            teamMemberId: null,
            employeeName: new RegExp(`^${escapeRegex(member.name)}$`, 'i'),
          },
        ],
      })
        .sort({ paymentDate: -1 })
        .limit(10)
        .lean(),
      TeamMember.find(buildListQuery(req, { reportsToId: member._id, status: 'active' }))
        .select('name jobTitle department')
        .sort({ name: 1 })
        .lean(),
    ]);

    res.json({
      data: {
        member,
        manager: member.reportsToId || null,
        directReports,
        leaveBalances: {
          annual: {
            allowance: annualAllowance,
            used: annualUsed,
            remaining: Math.max(0, annualAllowance - annualUsed),
          },
          sick: {
            allowance: sickAllowance,
            used: sickUsed,
            remaining: Math.max(0, sickAllowance - sickUsed),
          },
        },
        recentLeave: recentLeave.map((leave) => ({
          ...leave,
          dayCount: computeDayCount(leave.startDate, leave.endDate),
        })),
        recentPayroll,
        payrollTotal: recentPayroll.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
      },
    });
  } catch (error) {
    console.error('Error fetching team member profile:', error);
    handleScopeError(res, error);
  }
};

export const createTeamMember = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const member = await TeamMember.create({
      ...buildCreateScope(req),
      ...buildTeamMemberPayload(req.body),
    });

    res.status(201).json({ data: member });
  } catch (error) {
    console.error('Error creating team member:', error);
    handleScopeError(res, error);
  }
};

/** Import / refresh Team members from the active workspace membership list. */
export const syncTeamMembersFromActiveWorkspace = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const scope = req.dataScope;
    if (scope?.mode !== 'workspace' || !scope.workspaceId) {
      return res.status(400).json({
        error: 'Switch to a workspace to synchronize team members from workspace membership.',
      });
    }

    const result = await syncTeamMembersFromWorkspace({
      workspaceId: scope.workspaceId,
      createdByUserId: req.user._id,
      markMissingInactive: true,
    });

    const members = await TeamMember.find(buildListQuery(req))
      .populate('reportsToId', 'name jobTitle')
      .sort({ name: 1 });

    res.json({
      message: 'Team synchronized from workspace',
      data: members,
      sync: result,
    });
  } catch (error) {
    console.error('Error syncing team members from workspace:', error);
    handleScopeError(res, error);
  }
};

export const updateTeamMember = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const member = await TeamMember.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!member) return res.status(404).json({ error: 'Team member not found' });

    if (req.body.reportsToId && String(req.body.reportsToId) === String(member._id)) {
      return res.status(400).json({ error: 'A team member cannot report to themselves' });
    }

    applyTeamMemberFields(member, req.body);
    await member.save();
    res.json({ data: member });
  } catch (error) {
    console.error('Error updating team member:', error);
    handleScopeError(res, error);
  }
};

export const deleteTeamMember = async (req, res) => {
  try {
    assertPageAccess(req, 'team');
    const member = await TeamMember.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!member) return res.status(404).json({ error: 'Team member not found' });

    res.json({ message: 'Team member deleted', data: member });
  } catch (error) {
    console.error('Error deleting team member:', error);
    handleScopeError(res, error);
  }
};
