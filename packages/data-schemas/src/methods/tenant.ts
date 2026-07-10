import type { FilterQuery, QueryOptions } from 'mongoose';
import type { ITenant, TenantCreateData, TenantQuery, TenantUpdateData } from '~/types';
import { runAsSystem } from '~/config/tenantContext';

const buildTenantFilter = (query: TenantQuery): FilterQuery<ITenant> => {
  const filter: FilterQuery<ITenant> = {};

  if (query._id !== undefined) {
    filter._id = query._id;
  }
  if (query.tenantId !== undefined) {
    filter.tenantId = Array.isArray(query.tenantId) ? { $in: query.tenantId } : query.tenantId;
  }
  if (query.slug !== undefined) {
    filter.slug = query.slug.trim().toLowerCase();
  }
  if (query.status !== undefined) {
    filter.status = Array.isArray(query.status) ? { $in: query.status } : query.status;
  }

  return filter;
};

export function createTenantMethods(mongoose: typeof import('mongoose')): {
  createTenant: (data: TenantCreateData) => Promise<ITenant>;
  listTenants: (query?: TenantQuery, options?: QueryOptions) => Promise<ITenant[]>;
  findTenant: (query: TenantQuery, options?: QueryOptions) => Promise<ITenant | null>;
  updateTenant: (query: TenantQuery, data: TenantUpdateData) => Promise<ITenant | null>;
} {
  async function createTenant(data: TenantCreateData): Promise<ITenant> {
    return runAsSystem(async () => {
      const Tenant = mongoose.models.Tenant;
      const tenant = await Tenant.create({
        tenantId: data.tenantId,
        name: data.name.trim(),
        slug: data.slug.trim().toLowerCase(),
        status: data.status ?? 'active',
        createdBy: data.createdBy,
      });
      return tenant.toObject();
    });
  }

  async function listTenants(query: TenantQuery = {}, options?: QueryOptions): Promise<ITenant[]> {
    return runAsSystem(async () => {
      const Tenant = mongoose.models.Tenant;
      return await Tenant.find(buildTenantFilter(query), null, options)
        .sort({ name: 1 })
        .lean<ITenant[]>();
    });
  }

  async function findTenant(query: TenantQuery, options?: QueryOptions): Promise<ITenant | null> {
    return runAsSystem(async () => {
      const Tenant = mongoose.models.Tenant;
      return await Tenant.findOne(buildTenantFilter(query), null, options).lean<ITenant>();
    });
  }

  async function updateTenant(query: TenantQuery, data: TenantUpdateData): Promise<ITenant | null> {
    return runAsSystem(async () => {
      const Tenant = mongoose.models.Tenant;
      const updateData = {
        ...data,
        slug: data.slug?.trim().toLowerCase(),
      };
      return await Tenant.findOneAndUpdate(
        buildTenantFilter(query),
        { $set: updateData },
        { new: true, runValidators: true },
      ).lean<ITenant>();
    });
  }

  return {
    createTenant,
    listTenants,
    findTenant,
    updateTenant,
  };
}

export type TenantMethods = ReturnType<typeof createTenantMethods>;
