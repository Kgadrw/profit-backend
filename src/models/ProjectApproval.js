import mongoose from 'mongoose';

const projectApprovalSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['close_project', 'deadline_extension'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    requestedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestedByName: {
      type: String,
      trim: true,
    },
    leadMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      required: true,
    },
    leadUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    responseNote: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    respondedAt: Date,
    // For deadline_extension requests
    proposedEndDate: Date,
    originalEndDate: Date,
  },
  { timestamps: true },
);

projectApprovalSchema.index({ leadUserId: 1, status: 1, createdAt: -1 });
projectApprovalSchema.index({ projectId: 1, type: 1, status: 1 });

const ProjectApproval = mongoose.model('ProjectApproval', projectApprovalSchema);

export default ProjectApproval;
