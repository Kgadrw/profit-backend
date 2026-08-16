import mongoose from 'mongoose';

const projectTaskSchema = new mongoose.Schema(
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
    milestoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectMilestone',
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'done'],
      default: 'todo',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    dueDate: {
      type: Date,
    },
    estimatedHours: {
      type: Number,
      min: 0,
    },
    completedAt: {
      type: Date,
    },
    startedAt: {
      type: Date,
    },
    activityEvents: {
      type: [
        {
          at: { type: Date, required: true },
          kind: {
            type: String,
            enum: ['created', 'started', 'progress', 'completed'],
            required: true,
          },
        },
      ],
      default: [],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

projectTaskSchema.index({ projectId: 1, status: 1 });
projectTaskSchema.index({ projectId: 1, milestoneId: 1, sortOrder: 1 });

const ProjectTask = mongoose.model('ProjectTask', projectTaskSchema);

export default ProjectTask;
