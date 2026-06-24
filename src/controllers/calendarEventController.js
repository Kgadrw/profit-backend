import CalendarEvent from '../models/CalendarEvent.js';
import { buildListQuery, buildCreateScope, assertPageAccess } from '../utils/dataScope.js';
import { handleScopeError } from '../utils/scopeErrors.js';

const parseDateRange = (start, end) => {
  const range = {};
  if (start) {
    const startDate = new Date(start);
    if (!Number.isNaN(startDate.getTime())) {
      range.$gte = startDate;
    }
  }
  if (end) {
    const endDate = new Date(end);
    if (!Number.isNaN(endDate.getTime())) {
      range.$lte = endDate;
    }
  }
  return Object.keys(range).length ? range : null;
};

export const getCalendarEvents = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    const { start, end, status, eventType } = req.query;
    const query = buildListQuery(req);

    if (status) query.status = status;
    if (eventType) query.eventType = eventType;

    const dateRange = parseDateRange(start, end);
    if (dateRange) {
      query.startDate = dateRange;
    }

    const events = await CalendarEvent.find(query).sort({ startDate: 1 });
    res.json({ data: events });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    handleScopeError(res, error);
  }
};

export const getCalendarEvent = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    const event = await CalendarEvent.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!event) {
      return res.status(404).json({ error: 'Calendar event not found' });
    }

    res.json({ data: event });
  } catch (error) {
    console.error('Error fetching calendar event:', error);
    handleScopeError(res, error);
  }
};

export const createCalendarEvent = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    const {
      title,
      description,
      eventType,
      startDate,
      endDate,
      allDay,
      location,
      color,
      status,
      reminderMinutes,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ error: 'Event title is required' });
    }
    if (!startDate) {
      return res.status(400).json({ error: 'Start date is required' });
    }

    const event = await CalendarEvent.create({
      title: title.trim(),
      description: description?.trim() || '',
      eventType: eventType || 'event',
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      allDay: Boolean(allDay),
      location: location?.trim() || '',
      color: color?.trim() || '',
      status: status || 'scheduled',
      reminderMinutes: Number(reminderMinutes) || 0,
      ...buildCreateScope(req),
    });

    res.status(201).json({ data: event });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    handleScopeError(res, error);
  }
};

export const updateCalendarEvent = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    const event = await CalendarEvent.findOne(buildListQuery(req, { _id: req.params.id }));
    if (!event) {
      return res.status(404).json({ error: 'Calendar event not found' });
    }

    const fields = [
      'title',
      'description',
      'eventType',
      'startDate',
      'endDate',
      'allDay',
      'location',
      'color',
      'status',
      'reminderMinutes',
    ];

    for (const field of fields) {
      if (req.body[field] === undefined) continue;
      if (field === 'startDate' || field === 'endDate') {
        event[field] = req.body[field] ? new Date(req.body[field]) : null;
      } else if (field === 'allDay') {
        event.allDay = Boolean(req.body.allDay);
      } else if (field === 'reminderMinutes') {
        event.reminderMinutes = Number(req.body.reminderMinutes) || 0;
      } else if (typeof req.body[field] === 'string') {
        event[field] = req.body[field].trim();
      } else {
        event[field] = req.body[field];
      }
    }

    await event.save();
    res.json({ data: event });
  } catch (error) {
    console.error('Error updating calendar event:', error);
    handleScopeError(res, error);
  }
};

export const deleteCalendarEvent = async (req, res) => {
  try {
    assertPageAccess(req, 'calendar');
    const event = await CalendarEvent.findOneAndDelete(buildListQuery(req, { _id: req.params.id }));
    if (!event) {
      return res.status(404).json({ error: 'Calendar event not found' });
    }

    res.json({ message: 'Calendar event deleted', data: event });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    handleScopeError(res, error);
  }
};
