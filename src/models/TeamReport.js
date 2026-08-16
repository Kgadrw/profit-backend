import mongoose from 'mongoose';

const teamReportSchema = new mongoose.Schema(
  {
    submitterUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    submitterName: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200],
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200],
    },
    reportType: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      default: 'daily',
      index: true,
    },
    periodStart: {
      type: Date,
      required: [true, 'Period start is required'],
    },
    periodEnd: {
      type: Date,
      required: [true, 'Period end is required'],
    },
    accomplishments: {
      type: String,
      required: [true, 'Accomplishments are required'],
      trim: true,
      maxlength: [5000],
    },
    blockers: {
      type: String,
      trim: true,
      maxlength: [3000],
      default: '',
    },
    nextSteps: {
      type: String,
      trim: true,
      maxlength: [3000],
      default: '',
    },
    attachmentUrl: {
      type: String,
      trim: true,
      maxlength: [1000],
    },
    attachmentName: {
      type: String,
      trim: true,
      maxlength: [255],
    },
    reportTo: {
      type: [
        {
          memberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TeamMember',
            required: true,
          },
          userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
          },
          name: {
            type: String,
            trim: true,
            maxlength: [200],
            required: true,
          },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['submitted', 'reviewed', 'changes_requested', 'rejected'],
      default: 'submitted',
      index: true,
    },
    reviewedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedByName: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    reviewedAt: {
      type: Date,
    },
    reviewNote: {
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

teamReportSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
teamReportSchema.index({ submitterUserId: 1, createdAt: -1 });

const TeamReport = mongoose.model('TeamReport', teamReportSchema);

export default TeamReport;
