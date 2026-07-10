import type { Document, Types } from 'mongoose';

export type TenantMembershipStatus = 'active' | 'invited' | 'disabled';
export type TenantMembershipSource = 'stara' | 'legacy' | 'invite';

export interface ITenantMembership extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId | string;
  tenantId: string;
  orgName?: string;
  roleLabel?: string;
  status: TenantMembershipStatus;
  isDefault?: boolean;
  invitedEmail?: string;
  source?: TenantMembershipSource;
  scopeIds?: string[];
  groupIds?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TenantMembershipCreateData {
  userId: Types.ObjectId | string;
  tenantId: string;
  orgName?: string;
  roleLabel?: string;
  status?: TenantMembershipStatus;
  isDefault?: boolean;
  invitedEmail?: string;
  source?: TenantMembershipSource;
  scopeIds?: string[];
  groupIds?: string[];
}

export interface TenantMembershipQuery {
  _id?: Types.ObjectId | string;
  userId?: Types.ObjectId | string;
  tenantId?: string;
  status?: TenantMembershipStatus | TenantMembershipStatus[];
  invitedEmail?: string;
  isDefault?: boolean;
}

export interface TenantMembershipUpdateData {
  orgName?: string;
  roleLabel?: string;
  status?: TenantMembershipStatus;
  isDefault?: boolean;
  invitedEmail?: string;
  source?: TenantMembershipSource;
  scopeIds?: string[];
  groupIds?: string[];
}
