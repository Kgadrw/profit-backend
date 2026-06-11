import mongoose from 'mongoose';

const subscriptionPaymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referenceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    externalId: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'RWF' },
    msisdn: { type: String, required: true },
    provider: { type: String, default: 'paypack' },
    idempotencyKey: { type: String, default: '' },
    providerStatus: { type: String, default: '' },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'TIMEOUT'],
      default: 'PENDING',
    },
    mtnStatus: { type: String, default: '' },
    mtnReason: { type: String, default: '' },
    financialTransactionId: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    lastSyncAt: { type: Date, default: null },
    syncIssues: {
      type: [
        {
          code: { type: String, required: true },
          message: { type: String, default: '' },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

subscriptionPaymentSchema.index({ userId: 1, status: 1, createdAt: -1 });
subscriptionPaymentSchema.index({ msisdn: 1, status: 1, createdAt: -1 });

const SubscriptionPayment = mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
export default SubscriptionPayment;
