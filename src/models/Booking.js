import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    clientName: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    serviceName: {
      type: String,
      required: [true, 'Service name is required'],
      trim: true,
    },
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
    },
    workerName: {
      type: String,
      trim: true,
    },
    startAt: {
      type: Date,
      required: [true, 'Start time is required'],
    },
    durationMinutes: {
      type: Number,
      default: 30,
      min: [5, 'Duration must be at least 5 minutes'],
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'],
      default: 'pending',
    },
    notes: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      enum: ['manual', 'online', 'phone'],
      default: 'manual',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

bookingSchema.index({ userId: 1, startAt: 1 });
bookingSchema.index({ userId: 1, status: 1 });
bookingSchema.index({ userId: 1, workerId: 1, startAt: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;
