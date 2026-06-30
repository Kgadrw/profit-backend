import mongoose from 'mongoose';

const documentVersionSchema = new mongoose.Schema(
  {
    versionNumber: { type: Number, required: true },
    fileUrl: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    fileSize: { type: Number, min: 0 },
    contentHash: { type: String, trim: true },
    changeNote: { type: String, trim: true, maxlength: 500 },
    uploadedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const documentShareSchema = new mongoose.Schema(
  {
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetName: { type: String, trim: true },
    permission: {
      type: String,
      enum: ['view', 'download', 'edit'],
      default: 'view',
    },
    grantedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    grantedByName: { type: String, trim: true },
    grantedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const documentSignatureSchema = new mongoose.Schema(
  {
    signerName: { type: String, required: true, trim: true },
    signerEmail: { type: String, trim: true },
    signerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    documentHash: { type: String, required: true, trim: true },
    signatureHash: { type: String, required: true, trim: true },
    algorithm: { type: String, default: 'SHA-256', trim: true },
    signedAt: { type: Date, default: Date.now },
    verificationStatus: {
      type: String,
      enum: ['verified', 'pending', 'invalid'],
      default: 'verified',
    },
  },
  { _id: true },
);

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
    registryType: {
      type: String,
      enum: ['general', 'contract', 'policy', 'template'],
      default: 'general',
      index: true,
    },
    registryStatus: {
      type: String,
      enum: ['draft', 'active', 'archived', 'expired'],
      default: 'draft',
      index: true,
    },
    effectiveDate: { type: Date },
    expiryDate: { type: Date },
    renewalDate: { type: Date },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
      index: true,
    },
    contractId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contract',
      default: null,
      index: true,
    },
    policyScope: { type: String, trim: true, maxlength: 300 },
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
    contentHash: {
      type: String,
      trim: true,
    },
    currentVersionNumber: {
      type: Number,
      default: 1,
      min: 1,
    },
    versions: {
      type: [documentVersionSchema],
      default: [],
    },
    shares: {
      type: [documentShareSchema],
      default: [],
    },
    signatures: {
      type: [documentSignatureSchema],
      default: [],
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
companyDocumentSchema.index({ workspaceId: 1, registryType: 1, registryStatus: 1 });

const CompanyDocument = mongoose.model('CompanyDocument', companyDocumentSchema);

export default CompanyDocument;
