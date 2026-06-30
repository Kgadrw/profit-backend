import mongoose from 'mongoose';

const companyAnnouncementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Announcement title is required'],
      trim: true,
    },
    body: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
      index: true,
    },
    endDate: {
      type: Date,
    },
    allDay: {
      type: Boolean,
      default: true,
    },
    scope: {
      type: String,
      enum: ['workspace', 'regional', 'global'],
      default: 'workspace',
      index: true,
    },
    regionCode: {
      type: String,
      enum: ['', 'Africa', 'Americas', 'Asia', 'Europe', 'Oceania'],
      default: '',
      trim: true,
    },
    priority: {
      type: String,
      enum: ['normal', 'high', 'critical'],
      default: 'normal',
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    createdByName: {
      type: String,
      trim: true,
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

companyAnnouncementSchema.index({ workspaceId: 1, status: 1, startDate: -1 });

const CompanyAnnouncement = mongoose.model('CompanyAnnouncement', companyAnnouncementSchema);

export default CompanyAnnouncement;
