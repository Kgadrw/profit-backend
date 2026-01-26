// Reset Token Model for PIN reset
import mongoose from 'mongoose';
import crypto from 'crypto';

const resetTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    index: { expireAfterSeconds: 0 }, // Auto-delete expired tokens
  },
  used: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

// Generate a secure random token
resetTokenSchema.statics.generateToken = function() {
  return crypto.randomBytes(32).toString('hex');
};

// Find valid token
resetTokenSchema.statics.findValidToken = async function(token) {
  return await this.findOne({
    token,
    used: false,
    expiresAt: { $gt: new Date() },
  });
};

const ResetToken = mongoose.model('ResetToken', resetTokenSchema);

export default ResetToken;
