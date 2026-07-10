import type { Document, Types } from 'mongoose';

export type TenantStatus = 'active' | 'disabled';

export interface ITenant extends Document {
  _id: Types.ObjectId;
  tenantId: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdBy: Types.ObjectId | string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TenantCreateData {
  tenantId: string;
  name: string;
  slug: string;
  status?: TenantStatus;
  createdBy: Types.ObjectId | string;
}

export interface TenantQuery {
  _id?: Types.ObjectId | string;
  tenantId?: string | string[];
  slug?: string;
  status?: TenantStatus | TenantStatus[];
}

export interface TenantUpdateData {
  name?: string;
  slug?: string;
  status?: TenantStatus;
}
