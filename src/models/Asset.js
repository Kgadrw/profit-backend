import mongoose from 'mongoose';

const maintenanceRecordSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    scheduledDate: { type: Date, required: true },
    completedDate: { type: Date },
    status: {
      type: String,
      enum: ['scheduled', 'completed', 'overdue', 'cancelled'],
      default: 'scheduled',
    },
    note: { type: String, trim: true, maxlength: 1000 },
    performedBy: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: true },
);

const custodyRecordSchema = new mongoose.Schema(
  {
    teamMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamMember' },
    assigneeName: { type: String, trim: true, maxlength: 200 },
    assignedAt: { type: Date, default: Date.now },
    returnedAt: { type: Date },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

const lifecycleEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: [
        'registered',
        'updated',
        'assigned',
        'returned',
        'maintenance',
        'audit',
        'status_change',
        'disposed',
      ],
      required: true,
    },
    summary: { type: String, trim: true, maxlength: 300, required: true },
    details: { type: String, trim: true, maxlength: 1000 },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, trim: true, maxlength: 200 },
    occurredAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const assetSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Asset title is required'],
      trim: true,
      maxlength: [200],
    },
    assetTag: {
      type: String,
      trim: true,
      maxlength: [50],
    },
    assetType: {
      type: String,
      trim: true,
      enum: ['vehicle', 'machinery', 'technology', 'equipment', 'furniture', 'building', 'other'],
      default: 'equipment',
    },
    manufacturer: { type: String, trim: true, maxlength: [120] },
    model: { type: String, trim: true, maxlength: [120] },
    serialNumber: {
      type: String,
      trim: true,
      maxlength: [100],
    },
    purchaseDate: {
      type: Date,
      required: [true, 'Purchase date is required'],
    },
    purchaseCost: {
      type: Number,
      required: [true, 'Purchase cost is required'],
      min: [0, 'Purchase cost must be non-negative'],
    },
    currentValue: {
      type: Number,
      min: 0,
    },
    assignedTo: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    teamMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      default: null,
      index: true,
    },
    location: {
      type: String,
      trim: true,
      maxlength: [200],
    },
    warrantyExpires: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['active', 'in_use', 'maintenance', 'retired', 'disposed'],
      default: 'active',
      index: true,
    },
    depreciationMethod: {
      type: String,
      enum: ['straight_line', 'none'],
      default: 'straight_line',
    },
    usefulLifeMonths: {
      type: Number,
      min: 0,
    },
    salvageValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [1000],
    },
    maintenanceRecords: [maintenanceRecordSchema],
    custodyHistory: [custodyRecordSchema],
    lifecycleEvents: [lifecycleEventSchema],
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

assetSchema.index({ userId: 1, status: 1, purchaseDate: -1 });
assetSchema.index({ userId: 1, purchaseDate: -1 });
assetSchema.index({ workspaceId: 1, assetTag: 1 });

const Asset = mongoose.model('Asset', assetSchema);

export default Asset;
