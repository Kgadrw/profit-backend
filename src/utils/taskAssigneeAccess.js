import TeamMember from '../models/TeamMember.js';
import { buildListQuery } from './dataScope.js';

async function findLinkedAssignee(req, assigneeId) {
  if (!assigneeId) return null;
  const member = await TeamMember.findOne(buildListQuery(req, { _id: assigneeId }))
    .select('linkedUserId')
    .lean();
  if (!member?.linkedUserId || String(member.linkedUserId) !== String(req.user._id)) {
    return null;
  }
  return member;
}

export async function isCurrentUserAssignee(req, assigneeId) {
  const member = await findLinkedAssignee(req, assigneeId);
  return Boolean(member);
}

/** Only the team member linked to the current user may change a task's status. */
export async function assertCurrentUserIsAssignee(
  req,
  assigneeId,
  message = 'Only the assigned team member can change task status',
) {
  const member = await findLinkedAssignee(req, assigneeId);
  if (!member) {
    const error = new Error(message);
    error.statusCode = 403;
    throw error;
  }
  return member;
}
