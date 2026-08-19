import ProjectApproval from '../models/ProjectApproval.js';
import Project from '../models/Project.js';
import TeamMember from '../models/TeamMember.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { buildListQuery, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';
import { sendEmail, renderEmailTemplate, getFrontendBaseUrl } from '../utils/emailService.js';

function buildLoginAwareUrl(baseUrl, path) {
  const encoded = encodeURIComponent(path);
  return `${baseUrl}/login?redirect=${encoded}`;
}

async function resolveProjectLead(project) {
  if (!project.leadMemberId) return null;
  const member = await TeamMember.findById(project.leadMemberId);
  if (!member?.linkedUserId) return null;
  const user = await User.findById(member.linkedUserId).select('_id name email');
  if (!user) return null;
  return { member, user };
}

async function notifyProjectLead(approval, project, type) {
  try {
    const leadUser = await User.findById(approval.leadUserId).select('name email');
    if (!leadUser?.email) return;

    const baseUrl = getFrontendBaseUrl();
    const approvalsUrl = buildLoginAwareUrl(baseUrl, '/approvals');

    const title =
      type === 'close_project'
        ? `Request to close project: ${project.name}`
        : `Deadline extension request: ${project.name}`;

    const body =
      type === 'close_project'
        ? `${approval.requestedByName} has requested to close the project "${project.name}". Please review in Approvals.`
        : `${approval.requestedByName} has requested a deadline extension for "${project.name}"${approval.proposedEndDate ? ` to ${new Date(approval.proposedEndDate).toLocaleDateString()}` : ''}.${approval.note ? ` Reason: ${approval.note}` : ''}`;

    await Notification.create({
      userId: approval.leadUserId,
      type: 'general',
      title,
      body,
      data: { projectApprovalId: String(approval._id), projectId: String(project._id), url: '/approvals' },
    });

    const html = renderEmailTemplate({
      greeting: `Hi ${leadUser.name || 'there'},`,
      bodyLines: [
        body,
        type === 'deadline_extension' && approval.note ? `<strong>Note:</strong> ${approval.note}` : '',
      ].filter(Boolean),
      ctaLabel: 'Review in Approvals',
      ctaUrl: approvalsUrl,
    });

    await sendEmail({ to: leadUser.email, subject: title, html });
  } catch (err) {
    console.error('Error notifying project lead:', err);
  }
}

async function notifyRequester(approval, project, approved) {
  try {
    const requester = await User.findById(approval.requestedByUserId).select('name email');
    if (!requester?.email) return;

    const baseUrl = getFrontendBaseUrl();
    const statusWord = approved ? 'approved' : 'rejected';
    const title =
      approval.type === 'close_project'
        ? `Project close request ${statusWord}: ${project.name}`
        : `Deadline extension ${statusWord}: ${project.name}`;

    const body = approved
      ? approval.type === 'close_project'
        ? `Your request to close "${project.name}" has been approved. The project is now closed.`
        : `Your deadline extension request for "${project.name}" has been approved.${approval.proposedEndDate ? ` New deadline: ${new Date(approval.proposedEndDate).toLocaleDateString()}.` : ''}`
      : `Your ${approval.type === 'close_project' ? 'close project' : 'deadline extension'} request for "${project.name}" was rejected.${approval.responseNote ? ` Reason: ${approval.responseNote}` : ''}`;

    await Notification.create({
      userId: approval.requestedByUserId,
      type: 'general',
      title,
      body,
      data: { projectId: String(project._id) },
    });

    const html = renderEmailTemplate({
      greeting: `Hi ${requester.name || 'there'},`,
      bodyLines: [body],
      ctaLabel: 'Open Trippo',
      ctaUrl: buildLoginAwareUrl(baseUrl, '/team'),
    });

    await sendEmail({ to: requester.email, subject: title, html });
  } catch (err) {
    console.error('Error notifying requester:', err);
  }
}

export const requestCloseProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(buildListQuery(req, { _id: projectId }));
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.status === 'completed' || project.status === 'cancelled') {
      return res.status(400).json({ error: 'Project is already closed' });
    }

    const lead = await resolveProjectLead(project);
    if (!lead) return res.status(400).json({ error: 'Project has no lead assigned. Please assign a project lead first.' });

    const existing = await ProjectApproval.findOne({
      projectId: project._id,
      type: 'close_project',
      status: 'pending',
    });
    if (existing) return res.status(400).json({ error: 'A close request is already pending for this project' });

    const approval = await ProjectApproval.create({
      projectId: project._id,
      workspaceId: project.workspaceId || req.dataScope?.workspaceId,
      type: 'close_project',
      requestedByUserId: req.user._id,
      requestedByName: req.user.name || 'User',
      leadMemberId: lead.member._id,
      leadUserId: lead.user._id,
      note: req.body.note || '',
    });

    void notifyProjectLead(approval, project, 'close_project');

    res.status(201).json({ data: approval.toObject() });
  } catch (error) {
    console.error('Error requesting project close:', error);
    handleScopeError(res, error);
  }
};

export const requestDeadlineExtension = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { proposedEndDate, note } = req.body;
    if (!proposedEndDate) return res.status(400).json({ error: 'Proposed end date is required' });

    const project = await Project.findOne(buildListQuery(req, { _id: projectId }));
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.status === 'completed' || project.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot extend deadline of a closed project' });
    }

    const lead = await resolveProjectLead(project);
    if (!lead) return res.status(400).json({ error: 'Project has no lead assigned' });

    const existing = await ProjectApproval.findOne({
      projectId: project._id,
      type: 'deadline_extension',
      status: 'pending',
    });
    if (existing) return res.status(400).json({ error: 'A deadline extension request is already pending' });

    const approval = await ProjectApproval.create({
      projectId: project._id,
      workspaceId: project.workspaceId || req.dataScope?.workspaceId,
      type: 'deadline_extension',
      requestedByUserId: req.user._id,
      requestedByName: req.user.name || 'User',
      leadMemberId: lead.member._id,
      leadUserId: lead.user._id,
      note: note || '',
      proposedEndDate: new Date(proposedEndDate),
      originalEndDate: project.targetEndDate || null,
    });

    void notifyProjectLead(approval, project, 'deadline_extension');

    res.status(201).json({ data: approval.toObject() });
  } catch (error) {
    console.error('Error requesting deadline extension:', error);
    handleScopeError(res, error);
  }
};

export const getProjectApprovals = async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const query = { leadUserId: req.user._id };
    if (status && status !== 'all') query.status = status;

    const approvals = await ProjectApproval.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('projectId', 'name status targetEndDate startDate');

    res.json({ data: approvals });
  } catch (error) {
    console.error('Error fetching project approvals:', error);
    handleScopeError(res, error);
  }
};

export const getProjectApprovalsByProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const approvals = await ProjectApproval.find({ projectId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ data: approvals });
  } catch (error) {
    console.error('Error fetching project approvals:', error);
    handleScopeError(res, error);
  }
};

export const respondToProjectApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, responseNote, completionNotes } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be approve or reject' });
    }

    const approval = await ProjectApproval.findById(id);
    if (!approval) return res.status(404).json({ error: 'Approval request not found' });

    if (String(approval.leadUserId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the project lead can respond to this request' });
    }

    if (approval.status !== 'pending') {
      return res.status(400).json({ error: 'This request has already been processed' });
    }

    const approved = action === 'approve';
    approval.status = approved ? 'approved' : 'rejected';
    approval.responseNote = responseNote || '';
    approval.respondedAt = new Date();
    await approval.save();

    if (approved) {
      const project = await Project.findById(approval.projectId);
      if (project) {
        if (approval.type === 'close_project') {
          project.status = 'completed';
          project.completedAt = new Date();
          if (completionNotes) project.completionNotes = String(completionNotes).trim().slice(0, 2000);
          await project.save();
        } else if (approval.type === 'deadline_extension') {
          if (approval.proposedEndDate) {
            project.targetEndDate = approval.proposedEndDate;
            await project.save();
          }
        }
        void notifyRequester(approval, project, true);
      }
    } else {
      const project = await Project.findById(approval.projectId);
      if (project) void notifyRequester(approval, project, false);
    }

    res.json({ data: approval.toObject() });
  } catch (error) {
    console.error('Error responding to project approval:', error);
    handleScopeError(res, error);
  }
};
