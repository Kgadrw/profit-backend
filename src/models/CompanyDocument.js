import mongoose from 'mongoose';

const companyDocumentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Document title is required'],
      trim: true,
      maxlength: [200, 'Title must be at most 200 characters'],
    },
    category: {
      type: String,
      trim: true,
      default: 'general',
      maxlength: [100, 'Category must be at most 100 characters'],
    },
    date: {
      type: Date,
      required: [true, 'Document date is required'],
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000, 'Note must be at most 1000 characters'],
    },
    fileUrl: {
      type: String,
      required: [true, 'File URL is required'],
      trim: true,
      maxlength: [500],
    },
    fileName: {
      type: String,
      required: [true, 'File name is required'],
      trim: true,
      maxlength: [255],
    },
    fileSize: {
      type: Number,
      min: 0,
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
  {
    timestamps: true,
  },
);

companyDocumentSchema.index({ userId: 1, date: -1 });

const CompanyDocument = mongoose.model('CompanyDocument', companyDocumentSchema);

export default CompanyDocument;
