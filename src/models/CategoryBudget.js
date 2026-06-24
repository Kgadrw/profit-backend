import mongoose from 'mongoose';

const categoryBudgetSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      maxlength: [100],
    },
    amount: {
      type: Number,
      required: [true, 'Budget amount is required'],
      min: [0, 'Budget amount must be non-negative'],
    },
    budgetPeriod: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly', 'custom'],
      default: 'monthly',
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    note: {
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

categoryBudgetSchema.index({ userId: 1, category: 1, periodStart: 1 });

const CategoryBudget = mongoose.model('CategoryBudget', categoryBudgetSchema);

export default CategoryBudget;
