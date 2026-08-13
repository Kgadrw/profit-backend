import express from 'express';
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  getWorkspaceMembers,
  inviteToWorkspace,
  previewWorkspaceInvite,
  acceptWorkspaceInvite,
  updateWorkspaceMember,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  searchInviteUsers,
} from '../controllers/workspaceController.js';
import {
  getWorkspaceMessages,
  sendWorkspaceMessage,
  markWorkspaceMessagesRead,
  editWorkspaceMessage,
  deleteWorkspaceMessage,
} from '../controllers/workspaceMessageController.js';
import {
  listDirectChatThreads,
  listAllDirectChatThreads,
  openDirectChat,
  getDirectChatMessages,
  sendDirectChatMessage,
  markDirectChatMessagesRead,
  editDirectChatMessage,
  deleteDirectChatMessage,
  uploadDirectChatAttachment,
  getChatUnreadSummary,
  getAllChatUnreadSummary,
} from '../controllers/workspaceDirectChatController.js';
import {
  profileUpload,
  uploadWorkspaceProfilePicture,
  removeWorkspaceProfilePicture,
  chatAttachmentUpload,
} from '../controllers/uploadController.js';
import { authenticateUser } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';

const router = express.Router();

router.get('/invites/:token', rateLimiters.general, previewWorkspaceInvite);

router.use(authenticateUser);
router.use(rateLimiters.general);

router.get('/', listWorkspaces);
router.post('/', createWorkspace);
router.get('/inbox/direct-chats', listAllDirectChatThreads);
router.get('/inbox/chat-unread-summary', getAllChatUnreadSummary);
router.patch('/:workspaceId', updateWorkspace);
router.post(
  '/:workspaceId/profile-picture',
  profileUpload.single('file'),
  uploadWorkspaceProfilePicture,
);
router.delete('/:workspaceId/profile-picture', removeWorkspaceProfilePicture);
router.get('/:workspaceId/members', getWorkspaceMembers);
router.get('/:workspaceId/messages', getWorkspaceMessages);
router.post('/:workspaceId/messages', sendWorkspaceMessage);
router.post('/:workspaceId/messages/read', markWorkspaceMessagesRead);
router.get('/:workspaceId/chat-unread-summary', getChatUnreadSummary);
router.patch('/:workspaceId/messages/:messageId', editWorkspaceMessage);
router.delete('/:workspaceId/messages/:messageId', deleteWorkspaceMessage);
router.get('/:workspaceId/direct-chats', listDirectChatThreads);
router.post('/:workspaceId/direct-chats', openDirectChat);
router.get('/:workspaceId/direct-chats/:conversationId/messages', getDirectChatMessages);
router.post('/:workspaceId/direct-chats/:conversationId/messages', sendDirectChatMessage);
router.patch('/:workspaceId/direct-chats/:conversationId/messages/:messageId', editDirectChatMessage);
router.delete('/:workspaceId/direct-chats/:conversationId/messages/:messageId', deleteDirectChatMessage);
router.post('/:workspaceId/direct-chats/:conversationId/read', markDirectChatMessagesRead);
router.post(
  '/:workspaceId/direct-chats/:conversationId/attachments',
  chatAttachmentUpload.single('file'),
  uploadDirectChatAttachment,
);
router.get('/:workspaceId/invite-search', searchInviteUsers);
router.post('/:workspaceId/invites', inviteToWorkspace);
router.post('/invites/:token/accept', acceptWorkspaceInvite);
router.patch('/:workspaceId/members/:memberId', updateWorkspaceMember);
router.delete('/:workspaceId/members/:memberId', removeWorkspaceMember);
router.delete('/:workspaceId/invites/:inviteId', revokeWorkspaceInvite);

export default router;
