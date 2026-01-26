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

// Find valid OTP
otpSchema.statics.findValidOTP = async function(email, otp) {
  return await this.findOne({
    email: email.toLowerCase().trim(),
    otp,
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
