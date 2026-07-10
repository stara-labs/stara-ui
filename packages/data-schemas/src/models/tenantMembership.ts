import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import tenantMembershipSchema from '~/schema/tenantMembership';

export function createTenantMembershipModel(
  mongoose: typeof import('mongoose'),
): Model<t.ITenantMembership> {
  applyTenantIsolation(tenantMembershipSchema);
  return (
    mongoose.models.TenantMembership ||
    mongoose.model<t.ITenantMembership>('TenantMembership', tenantMembershipSchema)
  );
}
