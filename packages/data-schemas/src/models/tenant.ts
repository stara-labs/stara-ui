import type * as t from '~/types';
import tenantSchema from '~/schema/tenant';

export function createTenantModel(
  mongoose: typeof import('mongoose'),
): import('mongoose').Model<t.ITenant> {
  return (
    (mongoose.models.Tenant as import('mongoose').Model<t.ITenant>) ||
    mongoose.model<t.ITenant>('Tenant', tenantSchema)
  );
}
