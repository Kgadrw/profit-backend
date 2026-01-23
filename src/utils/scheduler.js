// Scheduler Service for checking and sending schedule notifications
import cron from 'node-cron';
import Schedule from '../models/Schedule.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import { sendUserScheduleNotification, sendClientScheduleNotification } from './emailService.js';

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
};
