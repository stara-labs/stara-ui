const baseMethods = {
  countRoles: jest.fn(),
  getRoleByName: jest.fn(),
  findRolesByNames: jest.fn(),
  listRoles: jest.fn(),
};

const { PermissionTypes, Permissions } = require('librechat-data-provider');
const { createNativeRoleMethods, nativeRoleByName } = require('./nativeRoles');

const originalNativeRuntime = process.env.STARA_NATIVE_RUNTIME;

describe('native role compatibility methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_NATIVE_RUNTIME = 'true';
  });

  afterAll(() => {
    if (originalNativeRuntime == null) {
      delete process.env.STARA_NATIVE_RUNTIME;
    } else {
      process.env.STARA_NATIVE_RUNTIME = originalNativeRuntime;
    }
  });

  it('serves built-in route permissions without querying Mongo', async () => {
    const methods = createNativeRoleMethods(baseMethods);

    await expect(methods.getRoleByName('USER')).resolves.toMatchObject({
      name: 'USER',
      permissions: {
        [PermissionTypes.AGENTS]: {
          [Permissions.USE]: true,
          [Permissions.CREATE]: true,
        },
        [PermissionTypes.MCP_SERVERS]: {
          [Permissions.USE]: true,
        },
      },
    });
    await expect(methods.findRolesByNames(['ADMIN', 'missing'])).resolves.toEqual([
      expect.objectContaining({ name: 'ADMIN' }),
    ]);
    await expect(methods.countRoles()).resolves.toBe(2);
    await expect(methods.listRoles()).resolves.toEqual([
      expect.objectContaining({ name: 'ADMIN' }),
      expect.objectContaining({ name: 'USER' }),
    ]);
    expect(baseMethods.getRoleByName).not.toHaveBeenCalled();
  });

  it('returns detached role values and no role for unknown names', () => {
    const first = nativeRoleByName('USER');
    first.permissions[PermissionTypes.AGENTS][Permissions.USE] = false;

    expect(nativeRoleByName('USER').permissions[PermissionTypes.AGENTS][Permissions.USE]).toBe(
      true,
    );
    expect(nativeRoleByName('missing')).toBeNull();
  });

  it('delegates every read to the existing methods outside native mode', async () => {
    process.env.STARA_NATIVE_RUNTIME = 'false';
    baseMethods.getRoleByName.mockResolvedValue({ name: 'CUSTOM' });
    baseMethods.findRolesByNames.mockResolvedValue([{ name: 'CUSTOM' }]);
    baseMethods.countRoles.mockResolvedValue(1);
    baseMethods.listRoles.mockResolvedValue([{ name: 'CUSTOM' }]);
    const methods = createNativeRoleMethods(baseMethods);

    await expect(methods.getRoleByName('CUSTOM', '-_id')).resolves.toEqual({ name: 'CUSTOM' });
    await expect(methods.findRolesByNames(['CUSTOM'], 'name')).resolves.toEqual([
      { name: 'CUSTOM' },
    ]);
    await expect(methods.countRoles()).resolves.toBe(1);
    await expect(methods.listRoles({ limit: 10 })).resolves.toEqual([{ name: 'CUSTOM' }]);
    expect(baseMethods.getRoleByName).toHaveBeenCalledWith('CUSTOM', '-_id');
    expect(baseMethods.findRolesByNames).toHaveBeenCalledWith(['CUSTOM'], 'name');
    expect(baseMethods.listRoles).toHaveBeenCalledWith({ limit: 10 });
  });
});
