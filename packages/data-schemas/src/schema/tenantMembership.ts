import { Schema } from 'mongoose';
import type { ITenantMembership } from '~/types';

const tenantMembershipSchema: Schema<ITenantMembership> = new Schema<ITenantMembership>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    orgName: {
      type: String,
      maxlength: 256,
    },
    roleLabel: {
      type: String,
      maxlength: 128,
    },
    status: {
      type: String,
      enum: ['active', 'invited', 'disabled'],
      default: 'active',
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    invitedEmail: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['stara', 'legacy', 'invite'],
      default: 'stara',
    },
    scopeIds: {
      type: [String],
      default: [],
    },
    groupIds: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

tenantMembershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });
tenantMembershipSchema.index({ userId: 1, status: 1, isDefault: 1 });
tenantMembershipSchema.index({ invitedEmail: 1, status: 1 });
tenantMembershipSchema.index({ tenantId: 1, status: 1 });

export default tenantMembershipSchema;
