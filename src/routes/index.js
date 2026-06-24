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
} from '../controllers/uploadController.js';
import { authenticateUser } from '../middleware/auth.js';
import { requirePlusAccess } from '../middleware/requirePlusAccess.js';
import { apiLimiter } from '../middleware/security.js';
import recurringExpenseRoutes from './recurringExpenseRoutes.js';
import calendarEventRoutes from './calendarEventRoutes.js';
import teamMemberRoutes from './teamMemberRoutes.js';
import teamTaskRoutes from './teamTaskRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';
import subscriptionRoutes from './subscriptionRoutes.js';
import bookingRoutes from './bookingRoutes.js';
import contentRoutes from './contentRoutes.js';
import workspaceRoutes from './workspaceRoutes.js';

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
router.use('/recurring-expenses', recurringExpenseRoutes);
router.use('/calendar-events', calendarEventRoutes);
router.use('/team-members', teamMemberRoutes);
router.use('/team-tasks', teamTaskRoutes);
router.post('/uploads/receipt', authenticateUser, requirePlusAccess, apiLimiter, receiptUpload.single('file'), uploadReceipt);
router.post('/uploads/document', authenticateUser, requirePlusAccess, apiLimiter, documentUpload.single('file'), uploadCompanyDocument);
router.post('/uploads/profile-picture', authenticateUser, apiLimiter, profileUpload.single('file'), uploadProfilePicture);
router.delete('/uploads/profile-picture', authenticateUser, apiLimiter, removeProfilePicture);
router.get('/files/receipts/:userId/:filename', authenticateUser, requirePlusAccess, apiLimiter, getReceiptFile);
router.get('/files/documents/:userId/:filename', authenticateUser, requirePlusAccess, apiLimiter, getCompanyDocumentFile);
router.get('/files/profile/:userId/:filename', authenticateUser, apiLimiter, getProfilePictureFile);
router.use('/inventories', inventoryRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/bookings', bookingRoutes);
router.use('/content', contentRoutes);
router.use('/workspaces', workspaceRoutes);

export default router;
