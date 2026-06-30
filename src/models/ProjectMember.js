import mongoose from 'mongoose';

const projectMemberSchema = new mongoose.Schema(
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
    teamMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['lead', 'member', 'viewer'],
      default: 'member',
    },
  },
  { timestamps: true },
);

projectMemberSchema.index({ projectId: 1, teamMemberId: 1 }, { unique: true });

const ProjectMember = mongoose.model('ProjectMember', projectMemberSchema);

export default ProjectMember;
