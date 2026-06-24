import mongoose from 'mongoose';

const accountTransferSchema = new mongoose.Schema(
  {
    fromAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    toAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Transfer amount must be positive'],
    },
    transferDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    referenceNumber: {
      type: String,
      trim: true,
      maxlength: [100],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000],
    },
    reconciledAt: {
      type: Date,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

accountTransferSchema.index({ userId: 1, transferDate: -1 });

const AccountTransfer = mongoose.model('AccountTransfer', accountTransferSchema);

export default AccountTransfer;
