import Booking from '../models/Booking.js';

const ACTIVE_STATUSES = ['pending', 'confirmed', 'in_progress'];

function getEndAt(startAt, durationMinutes) {
  return new Date(new Date(startAt).getTime() + (durationMinutes || 30) * 60 * 1000);
}

async function hasWorkerConflict({ userId, workerId, startAt, durationMinutes, excludeId }) {
  if (!workerId) return false;

  const start = new Date(startAt);
  const end = getEndAt(start, durationMinutes);

  const existing = await Booking.find({
    userId,
    workerId,
    status: { $in: ACTIVE_STATUSES },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();

  return existing.some((booking) => {
    const otherStart = new Date(booking.startAt);
    const otherEnd = getEndAt(otherStart, booking.durationMinutes);
    return start < otherEnd && end > otherStart;
  });
}

export const getBookings = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot access booking data' });
    }

    const { status, date, from, to } = req.query;
    const query = { userId };

    if (status) {
      query.status = status;
    }

    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      query.startAt = { $gte: dayStart, $lte: dayEnd };
    } else if (from || to) {
      query.startAt = {};
      if (from) query.startAt.$gte = new Date(from);
      if (to) query.startAt.$lte = new Date(to);
    }

    const bookings = await Booking.find(query)
      .sort({ startAt: 1 })
      .lean();

    res.json({ data: bookings });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

export const createBooking = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot create bookings' });
    }

    const {
      clientName,
      phone,
      clientId,
      serviceId,
      serviceName,
      workerId,
      workerName,
      startAt,
      durationMinutes,
      notes,
      source,
      status,
    } = req.body;

    if (!clientName?.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }
    if (!serviceName?.trim()) {
      return res.status(400).json({ error: 'Service is required' });
    }
    if (!startAt) {
      return res.status(400).json({ error: 'Start time is required' });
    }

    const duration = Number(durationMinutes) || 30;
    const conflict = await hasWorkerConflict({
      userId,
      workerId,
      startAt,
      durationMinutes: duration,
    });
    if (conflict) {
      return res.status(409).json({ error: 'This worker already has a booking at that time' });
    }

    const booking = await Booking.create({
      clientName: clientName.trim(),
      phone: phone?.trim() || '',
      clientId: clientId || undefined,
      serviceId: serviceId || undefined,
      serviceName: serviceName.trim(),
      workerId: workerId || undefined,
      workerName: workerName?.trim() || '',
      startAt: new Date(startAt),
      durationMinutes: duration,
      notes: notes?.trim() || '',
      source: source || 'manual',
      status: status || 'pending',
      userId,
    });

    res.status(201).json({ data: booking });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
};

export const updateBooking = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot update bookings' });
    }

    const booking = await Booking.findOne({ _id: req.params.id, userId });
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const fields = [
      'clientName',
      'phone',
      'clientId',
      'serviceId',
      'serviceName',
      'workerId',
      'workerName',
      'startAt',
      'durationMinutes',
      'notes',
      'status',
      'source',
    ];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (field === 'startAt') {
          booking.startAt = new Date(req.body.startAt);
        } else if (typeof req.body[field] === 'string') {
          booking[field] = req.body[field].trim();
        } else {
          booking[field] = req.body[field];
        }
      }
    }

    const conflict = await hasWorkerConflict({
      userId,
      workerId: booking.workerId,
      startAt: booking.startAt,
      durationMinutes: booking.durationMinutes,
      excludeId: booking._id,
    });
    if (conflict) {
      return res.status(409).json({ error: 'This worker already has a booking at that time' });
    }

    await booking.save();
    res.json({ data: booking });
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
};

export const deleteBooking = async (req, res) => {
  try {
    const userId = req.user._id === 'admin' ? null : req.user._id;
    if (!userId) {
      return res.status(403).json({ error: 'Admin cannot delete bookings' });
    }

    const booking = await Booking.findOneAndDelete({ _id: req.params.id, userId });
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ data: booking });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
};
