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
      enum: ['general', 'finance', 'operations', 'sales', 'marketing', 'hr'],
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

const TeamMember = mongoose.model('TeamMember', teamMemberSchema);

export default TeamMember;
