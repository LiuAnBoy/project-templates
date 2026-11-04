/**
 * The environment variables of the infrastructure, spread into the config schema.
 *
 * Empty in the base, which needs none. A data overlay replaces this file with
 * its connection settings, required and validated with the rest at boot.
 */
export const infraEnv = {};
