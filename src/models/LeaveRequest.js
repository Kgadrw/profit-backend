import mongoose from 'mongoose';

const leaveRequestSchema = new mongoose.Schema(
  {
    teamMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
    },
    requesterUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    requesterName: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200],
    },
    leaveType: {
      type: String,
      enum: ['annual', 'sick', 'unpaid', 'personal', 'other'],
      default: 'annual',
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    reason: {
      type: String,
      trim: true,
      maxlength: [1000],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
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
    rejectionNote: {
      type: String,
      trim: true,
      maxlength: [500],
    },
    /** When true, approved/rejected decision is visible to other workspace members. */
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
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

leaveRequestSchema.index({ workspaceId: 1, status: 1, startDate: -1 });
leaveRequestSchema.index({ requesterUserId: 1, startDate: -1 });

const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);

export default LeaveRequest;
