// User Model
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { isBcryptHash, isValidPassword } from '../utils/passwordUtils.js';

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
    required: function requiredPhone() {
      return !this.googleId;
    },
    trim: true,
  },
  businessName: {
    type: String,
    trim: true,
    default: undefined,
  },
  profilePictureUrl: {
    type: String,
    trim: true,
    default: undefined,
  },
  role: {
    type: String,
    enum: ['salon_owner', 'barber'],
    default: 'salon_owner',
  },
  salonOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  barberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Barber',
    default: null,
  },
  password: {
    type: String,
    required: function requiredPassword() {
      return !this.googleId;
    },
    validate: {
      validator(v) {
        if (!v) return !this.googleId;
        if (isBcryptHash(v)) return true;
        return isValidPassword(v);
      },
      message: 'Password must be at least 8 characters',
    },
  },
  /** @deprecated Legacy PIN field — kept for existing accounts until migrated */
  pin: {
    type: String,
    select: false,
  },
  googleId: {
    type: String,
    trim: true,
    sparse: true,
    unique: true,
  },
  authProvider: {
    type: String,
    enum: ['local', 'google', 'both'],
    default: 'local',
  },

  paymentPlan: {
    active: { type: Boolean, default: true },
    planName: { type: String, default: 'Plus' },
    amount: { type: Number, default: 10000 },
    currency: { type: String, default: 'RWF' },
    intervalMonths: { type: Number, default: 1 },
    startDate: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    nextDueDate: { type: Date, default: null },
    lastPaidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'past_due', 'paused'], default: 'active' },
    lastReminderAt: { type: Date, default: null },
    reminderStage: { type: String, default: '' },
  },
}, {
  timestamps: true,
});

userSchema.pre('save', async function hashSecrets(next) {
  try {
    if (this.isModified('password') && this.password && !isBcryptHash(this.password)) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    if (this.isModified('pin') && this.pin && !isBcryptHash(this.pin)) {
      const salt = await bcrypt.genSalt(10);
      this.pin = await bcrypt.hash(this.pin, salt);
    }

    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function comparePassword(candidate) {
  if (!candidate) return false;

  if (this.password) {
    if (await bcrypt.compare(candidate, this.password)) {
      return true;
    }
  }

  // Legacy accounts created with a 4-digit PIN
  if (this.pin) {
    return bcrypt.compare(candidate, this.pin);
  }

  return false;
};

userSchema.methods.toJSON = function toJSON() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.pin;
  return userObject;
};

const User = mongoose.model('User', userSchema);

export default User;
