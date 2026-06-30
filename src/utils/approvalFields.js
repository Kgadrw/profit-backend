/** Mongoose field definitions shared by finance models with approval workflow. */
import mongoose from 'mongoose';

export const approvalFieldDefinitions = {
  approvalStatus: {
    type: String,
    enum: ['draft', 'pending_approval', 'approved', 'rejected'],
    default: 'approved',
    index: true,
  },
  submittedByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  submittedByName: {
    type: String,
    trim: true,
    maxlength: [200],
  },
  approvedByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  approvedByName: {
    type: String,
    trim: true,
    maxlength: [200],
  },
  approvedAt: {
    type: Date,
  },
  rejectionNote: {
    type: String,
    trim: true,
    maxlength: [500],
  },
};
