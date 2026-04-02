// Scheduler Service for checking and sending schedule notifications
import cron from 'node-cron';
import Schedule from '../models/Schedule.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import { sendUserScheduleNotification, sendClientScheduleNotification } from './emailService.js';
import Notification from '../models/Notification.js';
import { sendMonthlyPaymentReminder } from './emailService.js';

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
    const now = new Date();
    
    // Find all pending schedules that haven't been notified yet or need advance notification
    const schedulesToCheck = await Schedule.find({
      status: 'pending',
    }).populate('clientId');

    console.log(`Checking ${schedulesToCheck.length} schedules for notifications at ${now.toISOString()}`);

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

        // Send notification to user if enabled
        if (schedule.notifyUser) {
          try {
            await sendUserScheduleNotification(user, schedule, user);
            console.log(`✅ Sent user notification for schedule: ${schedule.title} at ${now.toISOString()}`);
          } catch (error) {
            console.error(`Error sending user notification:`, error);
          }
        }

        // Send notification to client if enabled and client exists
        if (schedule.notifyClient && schedule.clientId) {
          try {
            await sendClientScheduleNotification(schedule.clientId, schedule, user);
            console.log(`✅ Sent client notification for schedule: ${schedule.title} at ${now.toISOString()}`);
          } catch (error) {
            console.error(`Error sending client notification:`, error);
          }
        }

        // Update lastNotified with exact current time
        schedule.lastNotified = new Date();
        await schedule.save();
      }
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
    await checkAndSendNotifications();
  });

  // Also run on startup for immediate checks
  checkAndSendNotifications();
  
  console.log('✅ Schedule notification scheduler started - checking every minute');

  // Monthly payment reminders: run daily at 08:00 server time
  cron.schedule('0 8 * * *', async () => {
    await checkAndSendMonthlyPaymentReminders();
  });
  // Also run on startup once
  checkAndSendMonthlyPaymentReminders();
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
        body: `Your monthly payment of ${(plan.amount || 5800).toLocaleString()} ${(plan.currency || 'RWF')} is due on ${nextDue.toLocaleDateString()}.`,
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
