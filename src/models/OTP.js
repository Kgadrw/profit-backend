// OTP Model for email verification and password reset
import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  otp: {
    type: String,
    required: true,
  },
  purpose: {
    type: String,
    enum: ['password_reset', 'pin_reset', 'registration'],
    default: 'password_reset',
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000),
    index: { expireAfterSeconds: 0 },
  },
  used: {
    type: Boolean,
    default: false,
  },
  attempts: {
    type: Number,
    default: 0,
    max: 5,
  },
}, {
  timestamps: true,
});

otpSchema.statics.findValidOTP = async function findValidOTP(email, otp, purpose = 'password_reset') {
  const normalizedEmail = email.toLowerCase().trim();
  let purposeFilter;

  if (purpose === 'registration') {
    purposeFilter = { purpose: 'registration' };
  } else if (purpose === 'password_reset') {
    purposeFilter = {
      $or: [
        { purpose: 'password_reset' },
        { purpose: 'pin_reset' },
        { purpose: { $exists: false } },
      ],
    };
  } else {
    purposeFilter = { purpose };
  }

  return this.findOne({
    email: normalizedEmail,
    otp,
    ...purposeFilter,
    used: false,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 5 },
  });
};

otpSchema.methods.markAsUsed = async function markAsUsed() {
  this.used = true;
  await this.save();
};

otpSchema.methods.incrementAttempts = async function incrementAttempts() {
  this.attempts += 1;
  await this.save();
};

const OTP = mongoose.model('OTP', otpSchema);

export default OTP;
