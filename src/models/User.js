// User Model
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    unique: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
  },
  businessName: {
    type: String,
    trim: true,
    default: undefined, // Leave blank - user sets it in settings
  },
  role: {
    type: String,
    enum: ['salon_owner', 'barber'],
    default: 'salon_owner',
  },
  salonOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null, // Only set for barbers - links to salon owner
  },
  barberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Barber',
    default: null, // Only set for barber users - links to Barber record
  },
  pin: {
    type: String,
    required: [true, 'PIN is required'],
    minlength: 4,
    maxlength: 4,
  },

  // Monthly payment plan (admin-managed)
  paymentPlan: {
    active: { type: Boolean, default: true },
    amount: { type: Number, default: 5800 }, // RWF per month
    currency: { type: String, default: 'RWF' },
    intervalMonths: { type: Number, default: 1 },
    startDate: { type: Date, default: null }, // when plan starts (defaults to createdAt)
    nextDueDate: { type: Date, default: null }, // computed from startDate/lastPaidAt
    lastPaidAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'past_due', 'paused'], default: 'active' },
    lastReminderAt: { type: Date, default: null },
    reminderStage: { type: String, default: '' }, // e.g. 'due_3', 'due_0', 'overdue_7'
  },
}, {
  timestamps: true,
});

// Hash PIN before saving
userSchema.pre('save', async function(next) {
  // Only hash the PIN if it has been modified (or is new)
  if (!this.isModified('pin')) {
    return next();
  }

  try {
    // Hash the PIN
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare PIN
userSchema.methods.comparePin = async function(candidatePin) {
  return await bcrypt.compare(candidatePin, this.pin);
};

// Method to get user without sensitive data
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.pin;
  return userObject;
};

const User = mongoose.model('User', userSchema);

export default User;
