const { roleDefaults } = require('librechat-data-provider');
const { staraNativeRuntimeEnabled } = require('~/server/services/StaraNativeRuntime');

const cloneRole = (role) => (role == null ? role : JSON.parse(JSON.stringify(role)));

const nativeRoleByName = (roleName) => cloneRole(roleDefaults[roleName] ?? null);

const createNativeRoleMethods = (baseMethods) => ({
  countRoles: async (...args) =>
    staraNativeRuntimeEnabled()
      ? Object.keys(roleDefaults).length
      : baseMethods.countRoles(...args),
  getRoleByName: async (roleName, ...args) =>
    staraNativeRuntimeEnabled()
      ? nativeRoleByName(roleName)
      : baseMethods.getRoleByName(roleName, ...args),
  findRolesByNames: async (roleNames, ...args) =>
    staraNativeRuntimeEnabled()
      ? roleNames.map(nativeRoleByName).filter(Boolean)
      : baseMethods.findRolesByNames(roleNames, ...args),
  listRoles: async (...args) =>
    staraNativeRuntimeEnabled()
      ? Object.values(roleDefaults).map(cloneRole)
      : baseMethods.listRoles(...args),
});

module.exports = {
  createNativeRoleMethods,
  nativeRoleByName,
};
