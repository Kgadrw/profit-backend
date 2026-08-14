import mongoose from 'mongoose';

const teamTaskSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      required: [true, 'Assignee is required'],
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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
    department: {
      type: String,
      trim: true,
      lowercase: true,
      default: 'general',
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
    reminders: {
      type: [
        {
          offsetMinutes: {
            type: Number,
            min: [0, 'Reminder offset cannot be negative'],
            required: true,
          },
          sentAt: {
            type: Date,
            default: null,
          },
        },
      ],
      default: [],
    },
    monthKey: {
      type: String,
      trim: true,
      index: true,
    },
    completionNote: {
      type: String,
      trim: true,
    },
    completedAt: {
      type: Date,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
      index: true,
    },
    milestoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectMilestone',
      default: null,
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

teamTaskSchema.index({ userId: 1, assigneeId: 1, status: 1 });
teamTaskSchema.index({ userId: 1, monthKey: 1 });
teamTaskSchema.index({ userId: 1, projectId: 1, status: 1 });
teamTaskSchema.index({ workspaceId: 1, projectId: 1, status: 1 });

const TeamTask = mongoose.model('TeamTask', teamTaskSchema);

export default TeamTask;
