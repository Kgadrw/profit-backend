// OTP Model for PIN reset
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
    enum: ['pin_reset', 'registration'],
    default: 'pin_reset',
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
    index: { expireAfterSeconds: 0 }, // Auto-delete expired OTPs
  },
  used: {
    type: Boolean,
    default: false,
  },
  attempts: {
    type: Number,
    default: 0,
    max: 5, // Max 5 verification attempts
  },
}, {
  timestamps: true,
});

// Find valid OTP (purpose: pin_reset | registration)
otpSchema.statics.findValidOTP = async function(email, otp, purpose = 'pin_reset') {
  const normalizedEmail = email.toLowerCase().trim();
  const purposeFilter =
    purpose === 'pin_reset'
      ? { $or: [{ purpose: 'pin_reset' }, { purpose: { $exists: false } }] }
      : { purpose };

  return await this.findOne({
    email: normalizedEmail,
    otp,
    ...purposeFilter,
    used: false,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 5 },
  });
};

// Mark OTP as used
otpSchema.methods.markAsUsed = async function() {
  this.used = true;
  await this.save();
};

// Increment attempts
otpSchema.methods.incrementAttempts = async function() {
  this.attempts += 1;
  await this.save();
};

const OTP = mongoose.model('OTP', otpSchema);

export default OTP;
