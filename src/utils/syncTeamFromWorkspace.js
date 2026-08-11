import mongoose from 'mongoose';
import WorkspaceMember from '../models/WorkspaceMember.js';
import TeamMember from '../models/TeamMember.js';
import User from '../models/User.js';

/**
 * Upsert TeamMember rows for every WorkspaceMember in a workspace.
 * Matches on linkedUserId first, then email within the same workspace.
 * Refreshes name/email from User; does not overwrite HR fields.
 */
export async function syncTeamMembersFromWorkspace({
  workspaceId,
  createdByUserId,
  markMissingInactive = false,
}) {
  if (!workspaceId || !mongoose.Types.ObjectId.isValid(workspaceId)) {
    const error = new Error('Valid workspace id is required');
    error.statusCode = 400;
    throw error;
  }
  if (!createdByUserId || !mongoose.Types.ObjectId.isValid(createdByUserId)) {
    const error = new Error('Valid user id is required');
    error.statusCode = 400;
    throw error;
  }

  const workspaceObjectId = new mongoose.Types.ObjectId(String(workspaceId));
  const creatorObjectId = new mongoose.Types.ObjectId(String(createdByUserId));

  const memberships = await WorkspaceMember.find({ workspaceId: workspaceObjectId })
    .select('userId')
    .lean();

  const userIds = memberships.map((row) => row.userId).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } })
    .select('name email')
    .lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));

  const existingMembers = await TeamMember.find({ workspaceId: workspaceObjectId }).lean();
  const byLinkedUserId = new Map();
  const byEmail = new Map();
  for (const member of existingMembers) {
    if (member.linkedUserId) {
      byLinkedUserId.set(String(member.linkedUserId), member);
    }
    if (member.email) {
      byEmail.set(String(member.email).trim().toLowerCase(), member);
    }
  }

  let created = 0;
  let updated = 0;
  let reactivated = 0;
  const syncedUserIds = new Set();

  for (const membership of memberships) {
    const linkedUserId = membership.userId;
    if (!linkedUserId) continue;
    const linkedKey = String(linkedUserId);
    syncedUserIds.add(linkedKey);

    const user = userById.get(linkedKey);
    const name = (user?.name || '').trim() || user?.email || 'Workspace member';
    const email = (user?.email || '').trim().toLowerCase();

    let member =
      byLinkedUserId.get(linkedKey) ||
      (email ? byEmail.get(email) : null) ||
      null;

    if (!member) {
      const createdMember = await TeamMember.create({
        userId: creatorObjectId,
        workspaceId: workspaceObjectId,
        linkedUserId,
        name,
        email,
        department: 'general',
        status: 'active',
        notes: 'Synced from workspace',
      });
      byLinkedUserId.set(linkedKey, createdMember.toObject());
      if (email) byEmail.set(email, createdMember.toObject());
      created += 1;
      continue;
    }

    const patch = {};
    if (!member.linkedUserId || String(member.linkedUserId) !== linkedKey) {
      patch.linkedUserId = linkedUserId;
    }
    if (name && member.name !== name) patch.name = name;
    if (email && member.email !== email) patch.email = email;
    if (member.status === 'inactive') {
      patch.status = 'active';
      reactivated += 1;
    }

    if (Object.keys(patch).length > 0) {
      await TeamMember.updateOne({ _id: member._id }, { $set: patch });
      updated += 1;
      const next = { ...member, ...patch };
      byLinkedUserId.set(linkedKey, next);
      if (email) byEmail.set(email, next);
    }
  }

  let deactivated = 0;
  if (markMissingInactive) {
    for (const member of existingMembers) {
      if (!member.linkedUserId) continue;
      if (syncedUserIds.has(String(member.linkedUserId))) continue;
      if (member.status === 'inactive') continue;
      await TeamMember.updateOne({ _id: member._id }, { $set: { status: 'inactive' } });
      deactivated += 1;
    }
  }

  return {
    workspaceId: String(workspaceObjectId),
    membershipCount: memberships.length,
    created,
    updated,
    reactivated,
    deactivated,
    totalTeamMembers: existingMembers.length + created,
  };
}

/** Ensure a single workspace user has a linked TeamMember row. */
export async function ensureTeamMemberForWorkspaceUser({
  workspaceId,
  userId,
  createdByUserId,
}) {
  return syncTeamMembersFromWorkspace({
    workspaceId,
    createdByUserId: createdByUserId || userId,
    markMissingInactive: false,
  });
}
