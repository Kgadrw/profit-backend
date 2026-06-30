import mongoose from 'mongoose';

const timeEntrySchema = new mongoose.Schema(
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
    projectTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectTask',
      default: null,
      index: true,
    },
    teamMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    hours: {
      type: Number,
      required: true,
      min: 0.25,
    },
    note: {
      type: String,
      trim: true,
    },
    billable: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

timeEntrySchema.index({ projectId: 1, date: -1 });
timeEntrySchema.index({ teamMemberId: 1, date: -1 });

const TimeEntry = mongoose.model('TimeEntry', timeEntrySchema);

export default TimeEntry;
