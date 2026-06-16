import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'platform', immutable: true },
    adminEmail: {
      type: String,
      default: 'admin@trippo.rw',
      trim: true,
      lowercase: true,
    },
    adminPinHash: { type: String, required: true },
    subscriptionAmount: { type: Number, default: 10000, min: 0 },
    trialDays: { type: Number, default: 7, min: 0, max: 90 },
    currency: { type: String, default: 'RWF' },
    supportEmail: { type: String, default: '', trim: true },
    companyName: { type: String, default: 'Trippo', trim: true },
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: true },
);

platformSettingsSchema.methods.comparePin = async function comparePin(candidatePin) {
  return bcrypt.compare(String(candidatePin), this.adminPinHash);
};

const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);

export default PlatformSettings;
