import mongoose from 'mongoose';
import Workspace from '../models/Workspace.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import WorkspaceInvite from '../models/WorkspaceInvite.js';
import User from '../models/User.js';
import { sendEmail } from '../utils/emailService.js';
import { emitToUser } from '../utils/websocket.js';
import Notification from '../models/Notification.js';
import {
  ALL_WORKSPACE_PAGE_KEYS,
  WORKSPACE_PAGES,
  normalizePermissions,
} from '../constants/workspacePermissions.js';
import { syncTeamMembersFromWorkspace } from '../utils/syncTeamFromWorkspace.js';
import TeamMember from '../models/TeamMember.js';

function getFrontendBaseUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:8080';
}

async function getMembership(workspaceId, userId) {
  return WorkspaceMember.findOne({ workspaceId, userId });
}

async function assertWorkspaceAdmin(workspaceId, userId) {
  const membership = await getMembership(workspaceId, userId);
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    const error = new Error('Workspace admin access required');
    error.statusCode = 403;
    throw error;
  }
  return membership;
}

function formatMember(member, user) {
  return {
    id: member._id,
    userId: member.userId,
    role: member.role,
    permissions: normalizePermissions(member.permissions, member.role),
    name: user?.name || 'User',
    email: user?.email || '',
    profilePictureUrl: user?.profilePictureUrl || null,
    joinedAt: member.createdAt,
  };
}

function formatWorkspaceSummary(workspace, membership) {
  return {
    id: workspace._id,
    name: workspace.name,
    profilePictureUrl: workspace.profilePictureUrl || null,
    role: membership.role,
    permissions: normalizePermissions(membership.permissions, membership.role),
    ownerId: workspace.ownerId,
    isOwner: membership.role === 'owner',
  };
}

export const listWorkspaces = async (req, res) => {
  try {
    const userId = req.user._id;
    const memberships = await WorkspaceMember.find({ userId }).lean();
    const workspaceIds = memberships.map((m) => m.workspaceId);
    const workspaces = await Workspace.find({ _id: { $in: workspaceIds } }).lean();

    const byId = new Map(workspaces.map((w) => [String(w._id), w]));
    const payload = memberships
      .map((m) => {
        const workspace = byId.get(String(m.workspaceId));
        if (!workspace) return null;
        return formatWorkspaceSummary(workspace, m);
      })
      .filter(Boolean);

    res.json({ workspaces: payload, pages: WORKSPACE_PAGES });
  } catch (error) {
    console.error('List workspaces error:', error);
    res.status(500).json({ error: error.message || 'Failed to list workspaces' });
  }
};

export const updateWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { name } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    await assertWorkspaceAdmin(workspaceId, userId);

    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Workspace name is required' });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    workspace.name = trimmedName;
    await workspace.save();

    const membership = await getMembership(workspaceId, userId);

    res.json({
      message: 'Workspace updated',
      workspace: {
        id: workspace._id,
        name: workspace.name,
        profilePictureUrl: workspace.profilePictureUrl || null,
        role: membership?.role,
        permissions: normalizePermissions(membership?.permissions, membership?.role),
        isOwner: membership?.role === 'owner',
      },
    });
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update workspace' });
  }
};

export const createWorkspace = async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user._id;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Workspace name is required' });
    }

    const workspace = await Workspace.create({
      name: String(name).trim(),
      ownerId: userId,
      createdBy: userId,
    });

    await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId,
      role: 'owner',
      permissions: ALL_WORKSPACE_PAGE_KEYS,
    });

    try {
      await syncTeamMembersFromWorkspace({
        workspaceId: workspace._id,
        createdByUserId: userId,
      });
    } catch (syncError) {
      console.error('Workspace create team sync error:', syncError);
    }

    res.status(201).json({
      message: 'Workspace created',
      workspace: {
        id: workspace._id,
        name: workspace.name,
        profilePictureUrl: workspace.profilePictureUrl || null,
        role: 'owner',
        permissions: ALL_WORKSPACE_PAGE_KEYS,
        isOwner: true,
      },
    });
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({ error: error.message || 'Failed to create workspace' });
  }
};

export const getWorkspaceMembers = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    const myMembership = await getMembership(workspaceId, userId);
    if (!myMembership) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const members = await WorkspaceMember.find({ workspaceId }).lean();
    const userIds = members.map((m) => m.userId);
    const users = await User.find({ _id: { $in: userIds } }).select('name email profilePictureUrl').lean();
    const usersById = new Map(users.map((u) => [String(u._id), u]));

    const pendingInvites = await WorkspaceInvite.find({
      workspaceId,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    }).lean();

    res.json({
      members: members.map((m) => formatMember(m, usersById.get(String(m.userId)))),
      invites: pendingInvites.map((inv) => ({
        id: inv._id,
        email: inv.email,
        role: inv.role,
        permissions: normalizePermissions(inv.permissions, inv.role),
        expiresAt: inv.expiresAt,
      })),
      pages: WORKSPACE_PAGES,
      myRole: myMembership.role,
    });
  } catch (error) {
    console.error('Get workspace members error:', error);
    res.status(500).json({ error: error.message || 'Failed to load members' });
  }
};

export const inviteToWorkspace = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { email, role = 'member', permissions = [] } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    await assertWorkspaceAdmin(workspaceId, userId);

    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const inviteRole = role === 'admin' ? 'admin' : 'member';
    const invitePermissions = normalizePermissions(permissions, inviteRole);

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      const existingMember = await WorkspaceMember.findOne({
        workspaceId,
        userId: existingUser._id,
      });
      if (existingMember) {
        return res.status(400).json({ error: 'User is already in this workspace' });
      }
    }

    await WorkspaceInvite.updateMany(
      { workspaceId, email: normalizedEmail, status: 'pending' },
      { status: 'revoked' },
    );

    const token = WorkspaceInvite.generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await WorkspaceInvite.create({
      workspaceId,
      email: normalizedEmail,
      role: inviteRole,
      permissions: invitePermissions,
      token,
      invitedBy: userId,
      expiresAt,
    });

    const inviteUrl = `${getFrontendBaseUrl()}/workspace/invite/${token}`;
    const inviter = await User.findById(userId).select('name email').lean();
    const inviterName = inviter?.name || 'A teammate';
    const hasAccount = Boolean(existingUser);

    if (hasAccount) {
      const notification = await Notification.create({
        userId: existingUser._id,
        sentBy: String(userId),
        type: 'workspace_invite',
        title: `Invitation to ${workspace.name}`,
        body: `${inviterName} invited you to join the workspace "${workspace.name}".`,
        icon: '/logo.png',
        data: {
          workspaceId: String(workspace._id),
          workspaceName: workspace.name,
          inviteToken: token,
          inviteUrl,
          route: `/workspace/invite/${token}`,
          role: inviteRole,
        },
        read: false,
      });

      emitToUser(String(existingUser._id), 'notification:created', notification.toObject());
    }

    const emailSubject = hasAccount
      ? `You're invited to ${workspace.name} on Trippo`
      : `Join ${workspace.name} on Trippo — create your account`;

    const emailText = hasAccount
      ? `${inviterName} invited you to join workspace "${workspace.name}" on Trippo. You also have a notification in the app. Accept: ${inviteUrl}`
      : `${inviterName} invited you to join workspace "${workspace.name}" on Trippo. Create your account and accept: ${inviteUrl}`;

    const emailHtml = hasAccount
      ? `
        <p>Hello,</p>
        <p><strong>${inviterName}</strong> invited you to join the workspace <strong>${workspace.name}</strong> on Trippo.</p>
        <p>You also received this invitation in your Trippo notifications.</p>
        <p><a href="${inviteUrl}">Accept invitation</a></p>
        <p>This link expires in 7 days.</p>
      `
      : `
        <p>Hello,</p>
        <p><strong>${inviterName}</strong> invited you to join the workspace <strong>${workspace.name}</strong> on Trippo.</p>
        <p>Create your Trippo account with this email address, then accept the invitation:</p>
        <p><a href="${inviteUrl}">Accept invitation</a></p>
        <p>This link expires in 7 days.</p>
      `;

    await sendEmail({
      to: normalizedEmail,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    });

    res.status(201).json({
      message: hasAccount ? 'Invitation sent via email and in-app notification' : 'Invitation sent via email',
      hasAccount,
      delivery: hasAccount ? 'email_and_in_app' : 'email',
      invite: {
        id: invite._id,
        email: invite.email,
        role: invite.role,
        permissions: invitePermissions,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    console.error('Invite to workspace error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to send invite' });
  }
};

export const previewWorkspaceInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const invite = await WorkspaceInvite.findOne({ token, status: 'pending' }).lean();
    if (!invite || invite.expiresAt <= new Date()) {
      return res.status(404).json({ error: 'Invitation not found or expired' });
    }

    const workspace = await Workspace.findById(invite.workspaceId).lean();
    res.json({
      invite: {
        email: invite.email,
        role: invite.role,
        permissions: normalizePermissions(invite.permissions, invite.role),
        workspaceName: workspace?.name || 'Workspace',
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    console.error('Preview invite error:', error);
    res.status(500).json({ error: error.message || 'Failed to load invitation' });
  }
};

export const acceptWorkspaceInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user._id;
    const user = await User.findById(userId);

    const invite = await WorkspaceInvite.findOne({ token, status: 'pending' });
    if (!invite || invite.expiresAt <= new Date()) {
      return res.status(404).json({ error: 'Invitation not found or expired' });
    }

    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      return res.status(403).json({
        error: 'Sign in with the invited email address to accept this invitation',
        invitedEmail: invite.email,
      });
    }

    const existing = await WorkspaceMember.findOne({
      workspaceId: invite.workspaceId,
      userId,
    });
    if (existing) {
      invite.status = 'accepted';
      await invite.save();
      return res.json({ message: 'Already a member', workspaceId: invite.workspaceId });
    }

    await WorkspaceMember.create({
      workspaceId: invite.workspaceId,
      userId,
      role: invite.role,
      permissions: invite.permissions,
      invitedBy: invite.invitedBy,
    });

    invite.status = 'accepted';
    await invite.save();

    try {
      await syncTeamMembersFromWorkspace({
        workspaceId: invite.workspaceId,
        createdByUserId: invite.invitedBy || userId,
      });
    } catch (syncError) {
      console.error('Accept invite team sync error:', syncError);
    }

    const workspace = await Workspace.findById(invite.workspaceId).lean();

    res.json({
      message: 'Joined workspace successfully',
      workspace: {
        id: workspace._id,
        name: workspace.name,
        role: invite.role,
        permissions: normalizePermissions(invite.permissions, invite.role),
      },
    });
  } catch (error) {
    console.error('Accept invite error:', error);
    res.status(500).json({ error: error.message || 'Failed to accept invitation' });
  }
};

export const updateWorkspaceMember = async (req, res) => {
  try {
    const { workspaceId, memberId } = req.params;
    const { role, permissions } = req.body;
    const userId = req.user._id;

    await assertWorkspaceAdmin(workspaceId, userId);

    const member = await WorkspaceMember.findOne({ _id: memberId, workspaceId });
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (member.role === 'owner') {
      return res.status(400).json({ error: 'Cannot change the workspace owner role' });
    }

    if (role === 'admin' || role === 'member') {
      member.role = role;
    }

    if (Array.isArray(permissions)) {
      member.permissions = normalizePermissions(permissions, member.role);
    }

    await member.save();

    const user = await User.findById(member.userId).select('name email').lean();
    res.json({
      message: 'Member updated',
      member: formatMember(member, user),
    });
  } catch (error) {
    console.error('Update member error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update member' });
  }
};

export const removeWorkspaceMember = async (req, res) => {
  try {
    const { workspaceId, memberId } = req.params;
    const userId = req.user._id;

    await assertWorkspaceAdmin(workspaceId, userId);

    const member = await WorkspaceMember.findOne({ _id: memberId, workspaceId });
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (member.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove the workspace owner' });
    }

    if (String(member.userId) === String(userId)) {
      return res.status(400).json({ error: 'Use leave workspace to remove yourself' });
    }

    const removedUserId = member.userId;
    await member.deleteOne();

    try {
      await TeamMember.updateMany(
        {
          workspaceId,
          linkedUserId: removedUserId,
          status: { $ne: 'inactive' },
        },
        { $set: { status: 'inactive' } },
      );
    } catch (syncError) {
      console.error('Remove member team deactivate error:', syncError);
    }

    res.json({ message: 'Member removed from workspace' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to remove member' });
  }
};

export const searchInviteUsers = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { q } = req.query;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace id' });
    }

    await assertWorkspaceAdmin(workspaceId, userId);

    const term = String(q || '').trim();
    if (term.length < 2) {
      return res.json({ users: [] });
    }

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      $or: [
        { email: { $regex: escaped, $options: 'i' } },
        { name: { $regex: escaped, $options: 'i' } },
      ],
    })
      .select('name email profilePictureUrl')
      .limit(10)
      .lean();

    const members = await WorkspaceMember.find({ workspaceId }).select('userId').lean();
    const memberUserIds = new Set(members.map((m) => String(m.userId)));

    res.json({
      users: users.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        profilePictureUrl: u.profilePictureUrl || null,
        alreadyMember: memberUserIds.has(String(u._id)),
      })),
    });
  } catch (error) {
    console.error('Search invite users error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to search users' });
  }
};

export const revokeWorkspaceInvite = async (req, res) => {
  try {
    const { workspaceId, inviteId } = req.params;
    const userId = req.user._id;

    await assertWorkspaceAdmin(workspaceId, userId);

    const invite = await WorkspaceInvite.findOne({ _id: inviteId, workspaceId, status: 'pending' });
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    invite.status = 'revoked';
    await invite.save();

    res.json({ message: 'Invitation revoked' });
  } catch (error) {
    console.error('Revoke invite error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to revoke invite' });
  }
};
