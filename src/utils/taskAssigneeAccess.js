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

async function findLinkedAssigneeInList(req, assigneeIds) {
  if (!Array.isArray(assigneeIds) || assigneeIds.length === 0) return null;
  const members = await TeamMember.find(
    buildListQuery(req, { _id: { $in: assigneeIds }, linkedUserId: req.user._id }),
  )
    .select('linkedUserId')
    .lean();
  return members.length > 0 ? members[0] : null;
}

export async function isCurrentUserAssignee(req, assigneeIdOrTask) {
  if (assigneeIdOrTask?.assignees?.length > 0) {
    const member = await findLinkedAssigneeInList(req, assigneeIdOrTask.assignees);
    return Boolean(member);
  }
  const id = assigneeIdOrTask?.assigneeId || assigneeIdOrTask;
  const member = await findLinkedAssignee(req, id);
  return Boolean(member);
}

/** Only a team member linked to the current user may change a task's status. */
export async function assertCurrentUserIsAssignee(
  req,
  assigneeIdOrTask,
  message = 'Only an assigned team member can change task status',
) {
  if (assigneeIdOrTask?.assignees?.length > 0) {
    const member = await findLinkedAssigneeInList(req, assigneeIdOrTask.assignees);
    if (member) return member;
  }
  const id = assigneeIdOrTask?.assigneeId || assigneeIdOrTask;
  const member = await findLinkedAssignee(req, id);
  if (!member) {
    const error = new Error(message);
    error.statusCode = 403;
    throw error;
  }
  return member;
}
