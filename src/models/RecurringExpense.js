import mongoose from 'mongoose';

const recurringExpenseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Expense title is required'],
      trim: true,
      maxlength: 200,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount must be positive'],
    },
    category: {
      type: String,
      trim: true,
      default: 'general',
      maxlength: 100,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    frequency: {
      type: String,
      enum: ['weekly', 'monthly', 'yearly', 'custom'],
      default: 'monthly',
    },
    intervalDays: {
      type: Number,
      min: [1, 'Interval must be at least 1 day'],
      default: 30,
    },
    nextDueDate: {
      type: Date,
      required: [true, 'Next due date is required'],
    },
    autoRecord: {
      type: Boolean,
      default: false,
    },
    notifyEmail: {
      type: Boolean,
      default: true,
    },
    advanceNotificationDays: {
      type: Number,
      default: 1,
      min: [0, 'Advance notification days cannot be negative'],
    },
    repeatUntil: {
      type: Date,
    },
    active: {
      type: Boolean,
      default: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lastNotifiedAt: {
      type: Date,
    },
    lastReminderStage: {
      type: String,
      enum: ['advance', 'due', ''],
      default: '',
    },
  },
  { timestamps: true },
);

recurringExpenseSchema.index({ userId: 1, active: 1, nextDueDate: 1 });
recurringExpenseSchema.index({ active: 1, nextDueDate: 1 });

const RecurringExpense = mongoose.model('RecurringExpense', recurringExpenseSchema);

export default RecurringExpense;
