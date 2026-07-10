import { Schema } from 'mongoose';
import type { ITenant } from '~/types';

const tenantSchema: Schema<ITenant> = new Schema<ITenant>(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
      index: true,
    },
    createdBy: {
      type: Schema.Types.Mixed,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

tenantSchema.index({ status: 1, updatedAt: -1 });

export default tenantSchema;
