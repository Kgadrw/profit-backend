import mongoose from 'mongoose';

const teamMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Team member name is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    jobTitle: {
      type: String,
      trim: true,
    },
    department: {
      type: String,
      trim: true,
      lowercase: true,
      default: 'general',
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    notes: {
      type: String,
      trim: true,
    },
    employeeNumber: {
      type: String,
      trim: true,
    },
    hireDate: {
      type: Date,
    },
    terminationDate: {
      type: Date,
    },
    employmentType: {
      type: String,
      enum: ['full_time', 'part_time', 'contract', 'intern'],
      default: 'full_time',
    },
    reportsToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      default: null,
    },
    location: {
      type: String,
      trim: true,
    },
    emergencyContactName: {
      type: String,
      trim: true,
    },
    emergencyContactPhone: {
      type: String,
      trim: true,
    },
    annualLeaveAllowance: {
      type: Number,
      default: 21,
      min: 0,
    },
    sickLeaveAllowance: {
      type: Number,
      default: 10,
      min: 0,
    },
    linkedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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

teamMemberSchema.index({ userId: 1, status: 1 });
teamMemberSchema.index(
  { workspaceId: 1, linkedUserId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      workspaceId: { $type: 'objectId' },
      linkedUserId: { $type: 'objectId' },
    },
  },
);

const TeamMember = mongoose.model('TeamMember', teamMemberSchema);

export default TeamMember;
