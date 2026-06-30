import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
  {
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
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
      default: 'planning',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    startDate: {
      type: Date,
    },
    targetEndDate: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    leadMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      default: null,
      index: true,
    },
    clientName: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

projectSchema.index({ userId: 1, status: 1 });
projectSchema.index({ workspaceId: 1, status: 1 });

const Project = mongoose.model('Project', projectSchema);

export default Project;
