import TeamMember from '../models/TeamMember.js';
import { buildListQuery } from './dataScope.js';

/** Only the team member linked to the current user may change a task's status. */
export async function assertCurrentUserIsAssignee(req, assigneeId) {
  if (!assigneeId) {
    const error = new Error('Only the assigned team member can change task status');
    error.statusCode = 403;
    throw error;
  }

  const member = await TeamMember.findOne(buildListQuery(req, { _id: assigneeId }))
    .select('linkedUserId')
    .lean();

  if (!member || !member.linkedUserId || String(member.linkedUserId) !== String(req.user._id)) {
    const error = new Error('Only the assigned team member can change task status');
    error.statusCode = 403;
    throw error;
  }

  return member;
}
