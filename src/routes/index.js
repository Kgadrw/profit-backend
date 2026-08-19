// Main Routes Index
import express from 'express';
import productRoutes from './productRoutes.js';
import saleRoutes from './saleRoutes.js';
import authRoutes from './authRoutes.js';
import adminRoutes from './adminRoutes.js';
import clientRoutes from './clientRoutes.js';
import scheduleRoutes from './scheduleRoutes.js';
import serviceRoutes from './serviceRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import expenseRoutes from './expenseRoutes.js';
import incomeRoutes from './incomeRoutes.js';
import financeRoutes from './financeRoutes.js';
import payrollRoutes from './payrollRoutes.js';
import billRoutes from './billRoutes.js';
import taxRoutes from './taxRoutes.js';
import bankDepositRoutes from './bankDepositRoutes.js';
import loanRoutes from './loanRoutes.js';
import invoiceRoutes from './invoiceRoutes.js';
import vendorRoutes from './vendorRoutes.js';
import accountRoutes from './accountRoutes.js';
import categoryBudgetRoutes from './categoryBudgetRoutes.js';
import documentRoutes from './documentRoutes.js';
import assetRoutes from './assetRoutes.js';
import approvalRoutes from './approvalRoutes.js';
import {
  receiptUpload,
  uploadReceipt,
  getReceiptFile,
  documentUpload,
  uploadCompanyDocument,
  getCompanyDocumentFile,
  profileUpload,
  uploadProfilePicture,
  removeProfilePicture,
  getProfilePictureFile,
  getWorkspaceProfilePictureFile,
  getChatAttachmentFile,
  issueFileAccessToken,
} from '../controllers/uploadController.js';
import { authenticateUser } from '../middleware/auth.js';
import { authenticateFileAccess } from '../middleware/fileAccessAuth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { apiLimiter, rateLimiters } from '../middleware/security.js';
import recurringExpenseRoutes from './recurringExpenseRoutes.js';
import calendarEventRoutes from './calendarEventRoutes.js';
import teamMemberRoutes from './teamMemberRoutes.js';
import teamTaskRoutes from './teamTaskRoutes.js';
import projectRoutes from './projectRoutes.js';
import leaveRequestRoutes from './leaveRequestRoutes.js';
import teamReportRoutes from './teamReportRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';
import subscriptionRoutes from './subscriptionRoutes.js';
import bookingRoutes from './bookingRoutes.js';
import contentRoutes from './contentRoutes.js';
import workspaceRoutes from './workspaceRoutes.js';
import workspaceCategoryRoutes from './workspaceCategoryRoutes.js';
import corporateCalendarRoutes from './corporateCalendarRoutes.js';
import pushRoutes from './pushRoutes.js';
import greetingRoutes from './greetingRoutes.js';
import aiRoutes from './aiRoutes.js';
import projectApprovalRoutes from './projectApprovalRoutes.js';

const router = express.Router();

// API Routes
router.use('/products', productRoutes);
router.use('/sales', saleRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/clients', clientRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/services', serviceRoutes);
router.use('/notifications', notificationRoutes);
router.use('/expenses', expenseRoutes);
router.use('/incomes', incomeRoutes);
router.use('/finance', financeRoutes);
router.use('/payrolls', payrollRoutes);
router.use('/bills', billRoutes);
router.use('/taxes', taxRoutes);
router.use('/bank-deposits', bankDepositRoutes);
router.use('/loans', loanRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/vendors', vendorRoutes);
router.use('/accounts', accountRoutes);
router.use('/category-budgets', categoryBudgetRoutes);
router.use('/documents', documentRoutes);
router.use('/assets', assetRoutes);
router.use('/approvals', approvalRoutes);
router.use('/recurring-expenses', recurringExpenseRoutes);
router.use('/calendar-events', calendarEventRoutes);
router.use('/team-members', teamMemberRoutes);
router.use('/team-tasks', teamTaskRoutes);
router.use('/projects', projectRoutes);
router.use('/leave-requests', leaveRequestRoutes);
router.use('/team-reports', teamReportRoutes);
router.post('/uploads/receipt', authenticateUser, requirePlusAccess, apiLimiter, receiptUpload.single('file'), uploadReceipt);
router.post('/uploads/document', authenticateUser, requirePlusAccess, apiLimiter, documentUpload.single('file'), uploadCompanyDocument);
router.post('/uploads/profile-picture', authenticateUser, apiLimiter, profileUpload.single('file'), uploadProfilePicture);
router.delete('/uploads/profile-picture', authenticateUser, apiLimiter, removeProfilePicture);
router.post('/files/access-token', authenticateUser, rateLimiters.files, issueFileAccessToken);
router.get('/files/receipts/:userId/:filename', authenticateUser, requirePlusAccess, rateLimiters.files, getReceiptFile);
router.get('/files/documents/:userId/:filename', authenticateUser, requirePlusAccess, rateLimiters.files, getCompanyDocumentFile);
router.get('/files/profile/:userId/:filename', authenticateFileAccess, rateLimiters.files, getProfilePictureFile);
router.get(
  '/files/workspace-profile/:workspaceId/:filename',
  authenticateFileAccess,
  rateLimiters.files,
  getWorkspaceProfilePictureFile,
);
router.get(
  '/files/chat-attachments/:workspaceId/:conversationId/:filename',
  authenticateFileAccess,
  rateLimiters.files,
  getChatAttachmentFile,
);
router.use('/inventories', inventoryRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/bookings', bookingRoutes);
router.use('/content', contentRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/workspace-categories', workspaceCategoryRoutes);
router.use('/corporate-calendar', corporateCalendarRoutes);
router.use('/push', pushRoutes);
router.use('/greetings', greetingRoutes);
router.use('/ai', aiRoutes);
router.use('/project-approvals', projectApprovalRoutes);

export default router;
