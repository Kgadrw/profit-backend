// Barber Model
import mongoose from 'mongoose';

const barberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Barber name is required'],
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  barberUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null, // Links to barber's User account (if they have login)
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Index for faster queries
barberSchema.index({ userId: 1, isActive: 1 });
barberSchema.index({ userId: 1, name: 1 });

const Barber = mongoose.model('Barber', barberSchema);

export default Barber;
