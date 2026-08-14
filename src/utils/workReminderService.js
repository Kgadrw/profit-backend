import CalendarEvent from '../models/CalendarEvent.js';
import TeamTask from '../models/TeamTask.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendPushToUser } from './pushNotifications.js';
import { sendEmail } from './emailService.js';

const MINUTE = 60 * 1000;

function reminderIsDue(targetDate, reminder, now) {
  if (reminder.sentAt) return false;
  const notifyAt = new Date(targetDate).getTime() - Number(reminder.offsetMinutes || 0) * MINUTE;
  return Number.isFinite(notifyAt) && now.getTime() >= notifyAt;
}

function formatWhen(date) {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function deliverReminder({ userId, email, title, body, type, data }) {
  if (!userId) return;

  await Notification.create({
    userId,
    sentBy: 'system',
    type,
    title,
    body,
    icon: '/logo.png',
    data,
    read: false,
  });

  await sendPushToUser(userId, {
    title,
    body,
    icon: '/logo.png',
    badge: '/logo.png',
    tag: `${type}-${data.id}-${data.offsetMinutes}`,
    data: { href: data.href, ...data },
  });

  if (email) {
    await sendEmail({
      to: email,
      subject: title,
      text: body,
      html: `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;">${body}</p>
        <p style="font-family:Arial,sans-serif;font-size:14px;"><a href="${process.env.FRONTEND_URL || ''}${data.href}">Open in Trippo</a></p>`,
      fromName: 'Trippo reminders',
    });
  }
}

async function sendDueCalendarReminders(now) {
  const events = await CalendarEvent.find({
    status: 'scheduled',
    startDate: { $gte: new Date(now.getTime() - 2 * 24 * 60 * MINUTE) },
  });

  for (const event of events) {
    let changed = false;
    const reminders = Array.isArray(event.reminders) ? event.reminders : [];
    if (!reminders.length && Number(event.reminderMinutes) > 0) {
      reminders.push({ offsetMinutes: Number(event.reminderMinutes), sentAt: null });
      event.reminders = reminders;
      changed = true;
    }

    const owner = await User.findById(event.userId).select('email');
    for (const reminder of reminders) {
      if (!reminderIsDue(event.startDate, reminder, now)) continue;
      const body = `"${event.title}" starts ${formatWhen(event.startDate)}.`;
      await deliverReminder({
        userId: event.userId,
        email: owner?.email,
        title: event.eventType === 'meeting' ? 'Meeting reminder' : 'Calendar reminder',
        body,
        type: 'calendar_reminder',
        data: {
          id: String(event._id),
          eventId: String(event._id),
          offsetMinutes: reminder.offsetMinutes,
          href: '/calendar/view',
        },
      });
      reminder.sentAt = now;
      changed = true;
    }
    if (changed) await event.save();
  }
}

async function sendDueTaskReminders(now) {
  const tasks = await TeamTask.find({
    status: { $ne: 'done' },
    dueDate: { $gte: new Date(now.getTime() - 2 * 24 * 60 * MINUTE) },
  }).populate('assigneeId', 'linkedUserId email name');

  for (const task of tasks) {
    const reminders = Array.isArray(task.reminders) ? task.reminders : [];
    if (!reminders.length) continue;

    let changed = false;
    const member = task.assigneeId;
    const recipientIds = new Set();
    if (member?.linkedUserId) recipientIds.add(String(member.linkedUserId));
    if (task.userId) recipientIds.add(String(task.userId));

    for (const reminder of reminders) {
      if (!reminderIsDue(task.dueDate, reminder, now)) continue;
      const body = `Deadline approaching: "${task.title}" is due ${formatWhen(task.dueDate)}.`;
      for (const recipientId of recipientIds) {
        const user = await User.findById(recipientId).select('email');
        const email =
          String(recipientId) === String(member?.linkedUserId)
            ? member?.email || user?.email
            : user?.email;
        await deliverReminder({
          userId: recipientId,
          email,
          title: 'Task deadline reminder',
          body,
          type: 'task_deadline_reminder',
          data: {
            id: String(task._id),
            taskId: String(task._id),
            offsetMinutes: reminder.offsetMinutes,
            href: '/team/tasks',
          },
        });
      }
      reminder.sentAt = now;
      changed = true;
    }
    if (changed) await task.save();
  }
}

export async function dispatchWorkReminders(now = new Date()) {
  try {
    await Promise.all([sendDueCalendarReminders(now), sendDueTaskReminders(now)]);
  } catch (error) {
    console.error('Error dispatching work reminders:', error);
  }
}

export async function getUpcomingWorkReminders(scopeQuery, { days = 7, limit = 20 } = {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + days * 24 * 60 * MINUTE);
  const items = [];

  const [events, tasks] = await Promise.all([
    CalendarEvent.find({
      ...scopeQuery,
      status: 'scheduled',
      startDate: { $gte: now, $lte: horizon },
    })
      .sort({ startDate: 1 })
      .limit(limit)
      .lean(),
    TeamTask.find({
      ...scopeQuery,
      status: { $ne: 'done' },
      dueDate: { $gte: now, $lte: horizon },
    })
      .populate('assigneeId', 'name')
      .sort({ dueDate: 1 })
      .limit(limit)
      .lean(),
  ]);

  for (const event of events) {
    items.push({
      id: `event-${event._id}`,
      kind: event.eventType === 'meeting' ? 'meeting' : 'event',
      title: event.title,
      at: event.startDate,
      href: '/calendar/view',
      subtitle: event.location || event.eventType || 'Calendar',
      reminderOffsets: (event.reminders || [])
        .map((r) => r.offsetMinutes)
        .concat(event.reminderMinutes ? [event.reminderMinutes] : []),
    });
  }

  for (const task of tasks) {
    items.push({
      id: `task-${task._id}`,
      kind: 'deadline',
      title: task.title,
      at: task.dueDate,
      href: '/team/tasks',
      subtitle: task.assigneeId?.name || 'Team task',
      reminderOffsets: (task.reminders || []).map((r) => r.offsetMinutes),
    });
  }

  return items
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, limit);
}
