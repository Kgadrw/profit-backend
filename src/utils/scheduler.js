// Scheduler Service for checking and sending schedule notifications
import cron from 'node-cron';
import Schedule from '../models/Schedule.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import { sendUserScheduleNotification, sendClientScheduleNotification, sendUserScheduleDigest, sendClientScheduleDigest } from './emailService.js';
import Notification from '../models/Notification.js';
import { sendMonthlyPaymentReminder, sendRecurringExpenseReminder, sendRecurringExpenseDigest } from './emailService.js';
import RecurringExpense from '../models/RecurringExpense.js';
import {
  advanceRecurringExpense,
  createExpenseFromRecurring,
  daysBetweenDates,
  normalizeDateStart,
} from './recurringExpenseUtils.js';
import { getTrialEndsAt, isOnTrial } from './paymentPlanUtils.js';
import Expense from '../models/Expense.js';
import { reconcileStuckSubscriptionPayments } from '../controllers/subscriptionController.js';
import { checkUnreadMessageEmailReminders } from './chatNotifications.js';
import { purgeExpiredDirectMessages } from '../controllers/workspaceDirectChatController.js';
import { purgeExpiredGroupMessages } from '../controllers/workspaceMessageController.js';
import { dispatchWorkReminders } from './workReminderService.js';
import { shouldSkipBackgroundJobs } from './loadManager.js';

// Helper function to check if two dates are within the same minute
const isSameMinute = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate() &&
    d1.getHours() === d2.getHours() &&
    d1.getMinutes() === d2.getMinutes()
  );
};

// Helper function to check if current time is within 1 minute of scheduled time
const isTimeToSend = (scheduledDate, now) => {
  const scheduled = new Date(scheduledDate);
  const current = new Date(now);
  
  // Calculate difference in milliseconds
  const diff = Math.abs(scheduled - current);
  
  // Check if within 1 minute (60000 ms)
  return diff <= 60000 && scheduled <= current;
};

// Check and send notifications for schedules at exact time
const checkAndSendNotifications = async () => {
  try {
    if (shouldSkipBackgroundJobs()) {
      console.warn('Skipping schedule notifications while the server is under high load');
      return;
    }

    const now = new Date();
    const dueWindowEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

    const schedulesToCheck = await Schedule.find({
      status: 'pending',
      dueDate: { $lte: dueWindowEnd },
    })
      .populate('clientId')
      .limit(1000);

    if (process.env.NODE_ENV === 'development') {
      console.log(`Checking ${schedulesToCheck.length} schedules for notifications at ${now.toISOString()}`);
    }

    // Batch emails that fire in the same minute for the same recipient.
    const userDigest = new Map(); // userId -> { user, schedules: [] }
    const clientDigest = new Map(); // clientEmail -> { client, senderUser, schedules: [] }
    const schedulesToMark = [];

    for (const schedule of schedulesToCheck) {
      const dueDate = new Date(schedule.dueDate);
      const nowDate = new Date(now);
      
      // Calculate days until due date
      const daysUntilDue = Math.ceil((dueDate - nowDate) / (1000 * 60 * 60 * 24));
      
      // Check if we should send advance notification
      const shouldSendAdvance = schedule.advanceNotificationDays > 0 && 
                                daysUntilDue === schedule.advanceNotificationDays &&
                                isTimeToSend(
                                  new Date(dueDate.getTime() - (schedule.advanceNotificationDays * 24 * 60 * 60 * 1000)),
                                  now
                                );

      // Check if we should send due date notification (exact time match)
      const shouldSendDue = daysUntilDue === 0 && isTimeToSend(dueDate, now);

      // Check if we already sent notification for this exact time
      const lastNotified = schedule.lastNotified ? new Date(schedule.lastNotified) : null;
      const alreadyNotified = lastNotified && (
        (shouldSendDue && isSameMinute(lastNotified, dueDate)) ||
        (shouldSendAdvance && isSameMinute(lastNotified, new Date(dueDate.getTime() - (schedule.advanceNotificationDays * 24 * 60 * 60 * 1000))))
      );

      if ((shouldSendAdvance || shouldSendDue) && !alreadyNotified) {
        // Get user
        const user = await User.findById(schedule.userId);
        if (!user) {
          console.error(`User not found for schedule ${schedule._id}`);
          continue;
        }

        if (schedule.notifyUser && user.email) {
          const key = String(user._id);
          const existing = userDigest.get(key) || { user, schedules: [] };
          existing.schedules.push(schedule);
          userDigest.set(key, existing);
        }

        if (schedule.notifyClient && schedule.clientId?.email) {
          const key = String(schedule.clientId.email).toLowerCase();
          const existing = clientDigest.get(key) || {
            client: schedule.clientId,
            senderUser: user,
            schedules: [],
          };
          existing.schedules.push(schedule);
          clientDigest.set(key, existing);
        }

        schedulesToMark.push(schedule);
      }
    }

    for (const entry of userDigest.values()) {
      try {
        if (entry.schedules.length === 1) {
          await sendUserScheduleNotification(entry.user, entry.schedules[0], entry.user);
        } else {
          await sendUserScheduleDigest(entry.user, entry.schedules, entry.user);
        }
        console.log(
          `✅ Sent user schedule digest (${entry.schedules.length}) to ${entry.user.email}`,
        );
      } catch (error) {
        console.error(`Error sending user schedule digest:`, error);
      }
    }

    for (const entry of clientDigest.values()) {
      try {
        if (entry.schedules.length === 1) {
          await sendClientScheduleNotification(entry.client, entry.schedules[0], entry.senderUser);
        } else {
          await sendClientScheduleDigest(entry.client, entry.schedules, entry.senderUser);
        }
        console.log(
          `✅ Sent client schedule digest (${entry.schedules.length}) to ${entry.client.email}`,
        );
      } catch (error) {
        console.error(`Error sending client schedule digest:`, error);
      }
    }

    for (const schedule of schedulesToMark) {
      schedule.lastNotified = new Date();
      await schedule.save();
    }
  } catch (error) {
    console.error('Error in schedule notification check:', error);
  }
};

// Start scheduler - runs every minute to check for exact times
export const startScheduler = () => {
  console.log('Starting schedule notification scheduler...');
  console.log('Scheduler will check every minute for exact scheduled times');
  
  // Run every minute to check for exact scheduled times
  // Format: second minute hour day month weekday
  cron.schedule('* * * * *', async () => {
    if (shouldSkipBackgroundJobs()) return;
    await checkAndSendNotifications();
    await dispatchWorkReminders();
  });

  // Also run on startup for immediate checks
  checkAndSendNotifications();
  dispatchWorkReminders().catch((error) => {
    console.error('Startup work reminder dispatch failed:', error);
  });
  
  console.log('✅ Schedule notification scheduler started - checking every minute');

  // Monthly payment reminders: run daily at 08:00 server time
  cron.schedule('0 8 * * *', async () => {
    if (shouldSkipBackgroundJobs()) return;
    await checkAndSendMonthlyPaymentReminders();
    await checkRecurringExpenses();
    try {
      await checkUnreadMessageEmailReminders();
    } catch (error) {
      console.error('Error checking unread message email reminders:', error);
    }
  });
  // Also run on startup once
  checkAndSendMonthlyPaymentReminders();
  checkRecurringExpenses();
  setTimeout(() => {
    checkUnreadMessageEmailReminders().catch((error) => {
      console.error('Startup unread message email check failed:', error);
    });
  }, 20000);

  // Reconcile stuck subscription payments every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await reconcileStuckSubscriptionPayments();
    } catch (error) {
      console.error('Error reconciling stuck subscription payments:', error);
    }
  });
  setTimeout(() => {
    reconcileStuckSubscriptionPayments().catch((error) => {
      console.error('Startup subscription payment reconcile failed:', error);
    });
  }, 15000);

  // Purge expired disappearing messages every minute
  cron.schedule('* * * * *', async () => {
    if (shouldSkipBackgroundJobs()) return;
    try {
      const [dmPurged, groupPurged] = await Promise.all([
        purgeExpiredDirectMessages(),
        purgeExpiredGroupMessages(),
      ]);
      if (dmPurged || groupPurged) {
        console.log(
          `Purged disappearing messages — DM: ${dmPurged}, group: ${groupPurged}`,
        );
      }
    } catch (error) {
      console.error('Error purging disappearing messages:', error);
    }
  });
};

const daysBetween = (a, b) => {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
};

const checkAndSendMonthlyPaymentReminders = async () => {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const users = await User.find({}).select('_id name email createdAt paymentPlan').lean();
    if (!users.length) return;

    for (const u of users) {
      const plan = u.paymentPlan || {};
      if (plan.active === false || plan.status === 'paused') continue;

      // Mark past_due when 7-day trial ends without payment
      if (!isOnTrial(u) && !plan.lastPaidAt && plan.status !== 'past_due') {
        const trialEnd = getTrialEndsAt(u);
        trialEnd.setHours(0, 0, 0, 0);
        if (now.getTime() >= trialEnd.getTime()) {
          await User.updateOne(
            { _id: u._id },
            { $set: { 'paymentPlan.status': 'past_due', 'paymentPlan.nextDueDate': trialEnd } },
          );
          plan.status = 'past_due';
        }
      }

      if (isOnTrial(u)) continue;

      const startDate = plan.startDate ? new Date(plan.startDate) : new Date(u.createdAt || Date.now());
      const nextDue = plan.nextDueDate ? new Date(plan.nextDueDate) : (() => {
        const nd = new Date(startDate);
        nd.setMonth(nd.getMonth() + (plan.intervalMonths || 1));
        return nd;
      })();
      nextDue.setHours(0, 0, 0, 0);

      const diffDays = daysBetween(now, nextDue); // positive means due in future

      let stage = null;
      if (diffDays === 3) stage = 'due_3';
      if (diffDays === 0) stage = 'due_0';
      if (diffDays === -7) stage = 'overdue_7';
      if (!stage) continue;

      // prevent resending same stage in same day
      const lastStage = plan.reminderStage || '';
      const lastAt = plan.lastReminderAt ? new Date(plan.lastReminderAt) : null;
      const sentToday = lastAt && daysBetween(now, new Date(lastAt.setHours(0,0,0,0))) === 0;
      if (lastStage === stage && sentToday) continue;

      // Send email (if configured)
      await sendMonthlyPaymentReminder(u, { ...plan, nextDueDate: nextDue }, { name: 'Trippo', email: '' }, { stage });

      // Create in-app notification
      await Notification.create({
        userId: u._id,
        sentBy: 'system',
        type: 'general',
        title: 'Payment reminder',
        body: `Your monthly payment of ${(plan.amount || 5000).toLocaleString()} ${(plan.currency || 'RWF')} is due on ${nextDue.toLocaleDateString()}.`,
        icon: '/logo.png',
        data: { kind: 'billing', stage, dueDate: nextDue.toISOString() },
        read: false,
      });

      // Update user's plan reminder metadata + mark past_due if overdue
      await User.updateOne(
        { _id: u._id },
        {
          $set: {
            'paymentPlan.startDate': startDate,
            'paymentPlan.nextDueDate': nextDue,
            'paymentPlan.lastReminderAt': new Date(),
            'paymentPlan.reminderStage': stage,
            'paymentPlan.status': diffDays < 0 ? 'past_due' : (plan.status || 'active'),
          },
        }
      );
    }
  } catch (error) {
    console.error('Error in monthly payment reminder check:', error);
  }
};

const reminderSentToday = (lastNotifiedAt, stage, lastStage) => {
  if (!lastNotifiedAt || lastStage !== stage) return false;
  const last = normalizeDateStart(lastNotifiedAt);
  const today = normalizeDateStart(new Date());
  return last.getTime() === today.getTime();
};

const checkRecurringExpenses = async () => {
  try {
    const now = new Date();
    const today = normalizeDateStart(now);

    const recurringItems = await RecurringExpense.find({ active: true });
    if (!recurringItems.length) return;

    console.log(`Checking ${recurringItems.length} recurring expenses at ${now.toISOString()}`);

    const digestByUser = new Map(); // userId -> { user, items: [] }

    for (const item of recurringItems) {
      const dueDate = normalizeDateStart(item.nextDueDate);
      const diffDays = daysBetweenDates(today, dueDate);

      const user = await User.findById(item.userId);
      if (!user) {
        console.error(`User not found for recurring expense ${item._id}`);
        continue;
      }

      const shouldSendAdvance =
        item.notifyEmail &&
        item.advanceNotificationDays > 0 &&
        diffDays === item.advanceNotificationDays;

      const shouldSendDue = item.notifyEmail && diffDays === 0;
      const isOverdue = diffDays < 0;

      if (shouldSendAdvance && !reminderSentToday(item.lastNotifiedAt, 'advance', item.lastReminderStage)) {
        const key = String(user._id);
        const existing = digestByUser.get(key) || { user, items: [] };
        existing.items.push({ expense: item, stage: 'advance' });
        digestByUser.set(key, existing);
        await Notification.create({
          userId: user._id,
          sentBy: 'system',
          type: 'general',
          title: 'Upcoming expense',
          body: `${item.title} (${Number(item.amount).toLocaleString()} RWF) is due on ${dueDate.toLocaleDateString()}.`,
          icon: '/logo.png',
          data: { kind: 'recurring_expense', recurringId: String(item._id), stage: 'advance' },
          read: false,
        });
        item.lastNotifiedAt = new Date();
        item.lastReminderStage = 'advance';
        await item.save();
      }

      if ((shouldSendDue || isOverdue) && item.notifyEmail) {
        if (!reminderSentToday(item.lastNotifiedAt, 'due', item.lastReminderStage)) {
          const key = String(user._id);
          const existing = digestByUser.get(key) || { user, items: [] };
          existing.items.push({ expense: item, stage: 'due' });
          digestByUser.set(key, existing);
          await Notification.create({
            userId: user._id,
            sentBy: 'system',
            type: 'general',
            title: 'Payment pending',
            body: `${item.title} (${Number(item.amount).toLocaleString()} RWF) is due. Please complete the payment.`,
            icon: '/logo.png',
            data: { kind: 'recurring_expense', recurringId: String(item._id), stage: 'due' },
            read: false,
          });
          item.lastNotifiedAt = new Date();
          item.lastReminderStage = 'due';
          await item.save();
        }
      }

      if (diffDays <= 0 && item.autoRecord) {
        await createExpenseFromRecurring(Expense, item, item.userId, item.nextDueDate);
        await advanceRecurringExpense(item);
        console.log(`✅ Auto-recorded recurring expense: ${item.title}`);
      }

      if (isOverdue && !item.autoRecord && !item.notifyEmail) {
        continue;
      }
    }

    for (const entry of digestByUser.values()) {
      try {
        await sendRecurringExpenseDigest(entry.user, entry.items);
        console.log(
          `✅ Sent recurring expense digest (${entry.items.length}) to ${entry.user.email}`,
        );
      } catch (error) {
        console.error('Error sending recurring expense digest:', error);
      }
    }
  } catch (error) {
    console.error('Error in recurring expense check:', error);
  }
};
