// Schedule Controller
import Schedule from '../models/Schedule.js';
import Client from '../models/Client.js';

// Helper function to calculate next due date for recurring schedules
const calculateNextDueDate = (dueDate, frequency, repeatUntil) => {
  if (!frequency || frequency === 'once') return null;
  if (repeatUntil && new Date() > new Date(repeatUntil)) return null;

  const nextDate = new Date(dueDate);
  switch (frequency) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    case 'yearly':
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      break;
    default:
      return null;
  }

  if (repeatUntil && nextDate > new Date(repeatUntil)) {
    return null;
  }

  return nextDate;
};

// Get all schedules for a user
export const getSchedules = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access schedule data' });
    }
    const { status, upcoming, clientId } = req.query;
    
    let query = { userId };
    
    if (status) {
      query.status = status;
    }
    
    if (upcoming === 'true') {
      query.dueDate = { $gte: new Date() };
      query.status = 'pending';
    }
    
    if (clientId) {
      query.clientId = clientId;
    }

    const schedules = await Schedule.find(query)
      .populate('clientId', 'name email phone businessType')
      .sort({ dueDate: 1 });
    
    res.json({ data: schedules });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
};

// Get a single schedule
export const getSchedule = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access schedule data' });
    }
    const schedule = await Schedule.findOne({ _id: req.params.id, userId })
      .populate('clientId', 'name email phone businessType');
    
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    
    res.json({ data: schedule });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
};

// Create a new schedule
export const createSchedule = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create schedules' });
    }
    const {
      title,
      description,
      clientId,
      dueDate,
      frequency,
      amount,
      notifyUser,
      notifyClient,
      userNotificationMessage,
      clientNotificationMessage,
      advanceNotificationDays,
      repeatUntil,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Schedule title is required' });
    }

    if (!dueDate) {
      return res.status(400).json({ error: 'Due date is required' });
    }

    // Client is required for all schedules
    if (!clientId || !clientId.trim()) {
      return res.status(400).json({ error: 'A client must be assigned to this schedule' });
    }

    // Validate clientId exists
    const client = await Client.findOne({ _id: clientId, userId });
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Ensure dueDate preserves time component
    const parsedDueDate = new Date(dueDate);
    if (isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({ error: 'Invalid due date format' });
    }

    const schedule = new Schedule({
      title: title.trim(),
      description: description ? description.trim() : undefined,
      clientId: clientId,
      dueDate: parsedDueDate, // Preserves full date and time
      frequency: frequency || 'once',
      amount: amount !== undefined && amount !== null && amount !== '' ? Number(amount) : undefined,
      notifyUser: notifyUser !== undefined ? notifyUser : true,
      notifyClient: notifyClient !== undefined ? notifyClient : false,
      userNotificationMessage: userNotificationMessage ? userNotificationMessage.trim() : undefined,
      clientNotificationMessage: clientNotificationMessage ? clientNotificationMessage.trim() : undefined,
      advanceNotificationDays: advanceNotificationDays ? parseInt(advanceNotificationDays) : 0,
      repeatUntil: repeatUntil ? new Date(repeatUntil) : undefined,
      userId,
    });

    // Calculate next due date for recurring schedules
    if (schedule.frequency !== 'once') {
      schedule.nextDueDate = calculateNextDueDate(
        schedule.dueDate,
        schedule.frequency,
        schedule.repeatUntil
      );
    }

    await schedule.save();
    
    const populatedSchedule = await Schedule.findById(schedule._id)
      .populate('clientId', 'name email phone businessType');
    
    res.status(201).json({ data: populatedSchedule });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ error: 'Failed to create schedule' });
  }
};

// Update a schedule
export const updateSchedule = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update schedules' });
    }
    const schedule = await Schedule.findOne({ _id: req.params.id, userId });
    
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const {
      title,
      description,
      clientId,
      dueDate,
      frequency,
      amount,
      status,
      notifyUser,
      notifyClient,
      userNotificationMessage,
      clientNotificationMessage,
      advanceNotificationDays,
      repeatUntil,
    } = req.body;

    if (title !== undefined) schedule.title = title.trim();
    if (description !== undefined) schedule.description = description ? description.trim() : undefined;
    if (dueDate !== undefined) {
      const parsedDueDate = new Date(dueDate);
      if (isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({ error: 'Invalid due date format' });
      }
      schedule.dueDate = parsedDueDate; // Preserves full date and time
    }
    if (frequency !== undefined) schedule.frequency = frequency;
    if (amount !== undefined) schedule.amount = amount !== null && amount !== '' ? Number(amount) : undefined;
    if (status !== undefined) schedule.status = status;
    if (notifyUser !== undefined) schedule.notifyUser = notifyUser;
    if (notifyClient !== undefined) schedule.notifyClient = notifyClient;
    if (userNotificationMessage !== undefined) schedule.userNotificationMessage = userNotificationMessage ? userNotificationMessage.trim() : undefined;
    if (clientNotificationMessage !== undefined) schedule.clientNotificationMessage = clientNotificationMessage ? clientNotificationMessage.trim() : undefined;
    if (advanceNotificationDays !== undefined) schedule.advanceNotificationDays = parseInt(advanceNotificationDays);
    if (repeatUntil !== undefined) schedule.repeatUntil = repeatUntil ? new Date(repeatUntil) : undefined;

    // Validate clientId if provided - client is required, cannot be removed
    if (clientId !== undefined) {
      if (!clientId || !clientId.trim()) {
        return res.status(400).json({ error: 'A client must be assigned to this schedule. Cannot remove client assignment.' });
      }
      const client = await Client.findOne({ _id: clientId, userId });
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
      schedule.clientId = clientId;
    }

    // Recalculate next due date if frequency or due date changed
    if (schedule.frequency !== 'once') {
      schedule.nextDueDate = calculateNextDueDate(
        schedule.dueDate,
        schedule.frequency,
        schedule.repeatUntil
      );
    } else {
      schedule.nextDueDate = undefined;
    }

    await schedule.save();
    
    const populatedSchedule = await Schedule.findById(schedule._id)
      .populate('clientId', 'name email phone businessType');
    
    res.json({ data: populatedSchedule });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
};

// Delete a schedule
export const deleteSchedule = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete schedules' });
    }
    const schedule = await Schedule.findOneAndDelete({ _id: req.params.id, userId });
    
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    
    res.json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
};

// Mark schedule as completed
export const completeSchedule = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot complete schedules' });
    }
    const schedule = await Schedule.findOne({ _id: req.params.id, userId })
      .populate('clientId', 'name email phone businessType');
    
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const { completionMessage, notifyClient, notifyUser } = req.body;

    schedule.status = 'completed';
    
    // If recurring, create next occurrence
    if (schedule.frequency !== 'once' && schedule.nextDueDate) {
      const nextDueDate = schedule.nextDueDate;
      const newNextDueDate = calculateNextDueDate(
        nextDueDate,
        schedule.frequency,
        schedule.repeatUntil
      );

      if (newNextDueDate) {
        // Create new schedule for next occurrence
        const newSchedule = new Schedule({
          title: schedule.title,
          description: schedule.description,
          clientId: schedule.clientId,
          dueDate: nextDueDate,
          frequency: schedule.frequency,
          amount: schedule.amount,
          notifyUser: schedule.notifyUser,
          notifyClient: schedule.notifyClient,
          userNotificationMessage: schedule.userNotificationMessage,
          clientNotificationMessage: schedule.clientNotificationMessage,
          advanceNotificationDays: schedule.advanceNotificationDays,
          repeatUntil: schedule.repeatUntil,
          nextDueDate: newNextDueDate,
          userId,
        });
        await newSchedule.save();
      }
    }

    await schedule.save();
    
    // Send completion notification if requested
    if (notifyClient || notifyUser) {
      try {
        const User = (await import('../models/User.js')).default;
        const { sendCompletionNotification } = await import('../utils/emailService.js');
        const user = await User.findById(userId);
        
        if (user) {
          const message = completionMessage || `The schedule "${schedule.title}" has been marked as completed.`;
          console.log('Sending completion notification:', { 
            notifyClient: notifyClient && schedule.clientId && schedule.clientId.email,
            notifyUser: notifyUser,
            hasMessage: !!completionMessage,
            message 
          });
          
          await sendCompletionNotification(schedule, user, message, {
            notifyClient: notifyClient && schedule.clientId && schedule.clientId.email,
            notifyUser: notifyUser && user.email,
          });
          
          console.log('Completion notification sent successfully');
        } else {
          console.error('User not found for completion notification');
        }
      } catch (emailError) {
        console.error('Error sending completion notification:', emailError);
        // Don't fail the request if email fails
      }
    } else {
      console.log('Completion notification skipped:', { 
        notifyClient, 
        notifyUser, 
        hasMessage: !!completionMessage,
        completionMessage 
      });
    }
    
    const populatedSchedule = await Schedule.findById(schedule._id)
      .populate('clientId', 'name email phone businessType');
    
    res.json({ data: populatedSchedule });
  } catch (error) {
    console.error('Error completing schedule:', error);
    res.status(500).json({ error: 'Failed to complete schedule' });
  }
};

// Get upcoming schedules (for dashboard/widget)
export const getUpcomingSchedules = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access schedule data' });
    }
    const days = parseInt(req.query.days) || 7;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const schedules = await Schedule.find({
      userId,
      status: 'pending',
      dueDate: { $lte: endDate, $gte: new Date() },
    })
      .populate('clientId', 'name email phone businessType')
      .sort({ dueDate: 1 })
      .limit(10);

    res.json({ data: schedules });
  } catch (error) {
    console.error('Error fetching upcoming schedules:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming schedules' });
  }
};
