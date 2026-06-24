import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
      maxlength: [200],
    },
    type: {
      type: String,
      enum: ['cash', 'bank', 'momo', 'airtel'],
      default: 'cash',
    },
    institution: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    accountNumber: {
      type: String,
      trim: true,
      maxlength: [50],
    },
    openingBalance: {
      type: Number,
      default: 0,
      min: [0, 'Opening balance cannot be negative'],
    },
    openingBalanceDate: {
      type: Date,
      default: Date.now,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000],
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

accountSchema.index({ userId: 1, name: 1 });
accountSchema.index({ userId: 1, type: 1 });

const Account = mongoose.model('Account', accountSchema);

export default Account;
