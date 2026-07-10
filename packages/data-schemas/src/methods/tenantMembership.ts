import type { FilterQuery, QueryOptions } from 'mongoose';
import type {
  ITenantMembership,
  TenantMembershipCreateData,
  TenantMembershipQuery,
  TenantMembershipUpdateData,
} from '~/types';
import { runAsSystem } from '~/config/tenantContext';

const buildTenantMembershipFilter = (
  query: TenantMembershipQuery,
): FilterQuery<ITenantMembership> => {
  const filter: FilterQuery<ITenantMembership> = {};

  if (query._id !== undefined) {
    filter._id = query._id;
  }
  if (query.userId !== undefined) {
    filter.userId = query.userId;
  }
  if (query.tenantId !== undefined) {
    filter.tenantId = query.tenantId;
  }
  if (query.status !== undefined) {
    filter.status = Array.isArray(query.status) ? { $in: query.status } : query.status;
  }
  if (query.roleKey !== undefined) {
    filter.roleKey = Array.isArray(query.roleKey) ? { $in: query.roleKey } : query.roleKey;
  }
  if (query.invitedEmail !== undefined) {
    filter.invitedEmail = query.invitedEmail.trim().toLowerCase();
  }
  if (query.isDefault !== undefined) {
    filter.isDefault = query.isDefault;
  }

  return filter;
};

export function createTenantMembershipMethods(mongoose: typeof import('mongoose')): {
  listTenantMemberships: (
    query: TenantMembershipQuery,
    options?: QueryOptions,
  ) => Promise<ITenantMembership[]>;
  findTenantMembership: (
    query: TenantMembershipQuery,
    options?: QueryOptions,
  ) => Promise<ITenantMembership | null>;
  upsertTenantMembership: (data: TenantMembershipCreateData) => Promise<ITenantMembership>;
  updateTenantMembership: (
    query: TenantMembershipQuery,
    data: TenantMembershipUpdateData,
  ) => Promise<ITenantMembership | null>;
  setDefaultTenantMembership: (
    userId: string,
    tenantId: string,
  ) => Promise<ITenantMembership | null>;
} {
  async function listTenantMemberships(
    query: TenantMembershipQuery,
    options?: QueryOptions,
  ): Promise<ITenantMembership[]> {
    return runAsSystem(async () => {
      const TenantMembership = mongoose.models.TenantMembership;
      const findQuery = TenantMembership.find(buildTenantMembershipFilter(query), null, options)
        .sort({
          isDefault: -1,
          updatedAt: -1,
        })
        .lean<ITenantMembership[]>();
      return await findQuery;
    });
  }

  async function findTenantMembership(
    query: TenantMembershipQuery,
    options?: QueryOptions,
  ): Promise<ITenantMembership | null> {
    return runAsSystem(async () => {
      const TenantMembership = mongoose.models.TenantMembership;
      return await TenantMembership.findOne(
        buildTenantMembershipFilter(query),
        null,
        options,
      ).lean<ITenantMembership>();
    });
  }

  async function upsertTenantMembership(
    data: TenantMembershipCreateData,
  ): Promise<ITenantMembership> {
    return runAsSystem(async () => {
      const TenantMembership = mongoose.models.TenantMembership;
      const status = data.status ?? 'active';
      const update = {
        $set: {
          tenantId: data.tenantId,
          orgName: data.orgName,
          roleLabel: data.roleLabel,
          roleKey: data.roleKey ?? 'member',
          status,
          isDefault: data.isDefault ?? false,
          invitedEmail: data.invitedEmail?.trim().toLowerCase(),
          source: data.source ?? 'stara',
          scopeIds: data.scopeIds ?? [],
          groupIds: data.groupIds ?? [],
        },
        $setOnInsert: {
          userId: data.userId,
        },
      };

      if (data.isDefault) {
        await TenantMembership.updateMany({ userId: data.userId }, { $set: { isDefault: false } });
      }

      const membership = await TenantMembership.findOneAndUpdate(
        { userId: data.userId, tenantId: data.tenantId },
        update,
        { new: true, upsert: true, runValidators: true },
      ).lean<ITenantMembership>();

      if (!membership) {
        throw new Error('Failed to upsert tenant membership');
      }

      return membership;
    });
  }

  async function updateTenantMembership(
    query: TenantMembershipQuery,
    data: TenantMembershipUpdateData,
  ): Promise<ITenantMembership | null> {
    return runAsSystem(async () => {
      const TenantMembership = mongoose.models.TenantMembership;
      const updateData = {
        ...data,
        invitedEmail: data.invitedEmail?.trim().toLowerCase(),
      };

      if (data.isDefault && query.userId) {
        await TenantMembership.updateMany({ userId: query.userId }, { $set: { isDefault: false } });
      }

      return await TenantMembership.findOneAndUpdate(
        buildTenantMembershipFilter(query),
        { $set: updateData },
        { new: true, runValidators: true },
      ).lean<ITenantMembership>();
    });
  }

  async function setDefaultTenantMembership(
    userId: string,
    tenantId: string,
  ): Promise<ITenantMembership | null> {
    return runAsSystem(async () => {
      const TenantMembership = mongoose.models.TenantMembership;
      await TenantMembership.updateMany({ userId }, { $set: { isDefault: false } });
      return await TenantMembership.findOneAndUpdate(
        { userId, tenantId, status: 'active' },
        { $set: { isDefault: true } },
        { new: true, runValidators: true },
      ).lean<ITenantMembership>();
    });
  }

  return {
    listTenantMemberships,
    findTenantMembership,
    upsertTenantMembership,
    updateTenantMembership,
    setDefaultTenantMembership,
  };
}

export type TenantMembershipMethods = ReturnType<typeof createTenantMembershipMethods>;
