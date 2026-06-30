import mongoose from 'mongoose';

const projectMilestoneSchema = new mongoose.Schema(
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
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Milestone title is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed'],
      default: 'pending',
      index: true,
    },
    dueDate: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

projectMilestoneSchema.index({ projectId: 1, sortOrder: 1 });

const ProjectMilestone = mongoose.model('ProjectMilestone', projectMilestoneSchema);

export default ProjectMilestone;
