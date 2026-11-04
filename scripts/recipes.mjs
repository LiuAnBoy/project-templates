/**
 * Recipes: the ordered source layers of each standalone template, and of each
 * UI overlay.
 *
 * Layer paths are relative to the repository root. Later layers override
 * earlier ones file by file, and their `package.fragment.json` is deep-merged
 * over the earlier fragments (see render.mjs).
 *
 * Layout of `source/`:
 *   web/common            files shared by both web bases
 *   web/next, web/vite    framework layer
 *   ui/plain              the documents of a base project, which has no UI library
 *   ui/<lib>/common       part of a UI overlay shared by both frameworks (antd, mui, heroui)
 *   ui/<lib>/<framework>  part of a UI overlay that only one framework needs (optional)
 *   server/common         files shared by all three backends
 *   server/node           files shared by the Node backends (nest, fastify)
 *   server/<name>         framework layer of one backend (nest, fastify, fastapi)
 *   workspace             the monorepo root with the contract package
 *   workspace-no-contract the root of a monorepo whose server is not a Node project
 *   data/compose          the main compose block of a data overlay with a server store
 *   data/integration/<fw> integration test config of one backend
 *   data/sql/<node|fastapi>  what every SQL store shares on that platform
 *   data/<store>/common, node, <fw>  one store's layers
 *   data/wiring/<fw>/<database|redis|database-redis>  the seam files, last
 *   data/none             the empty-store block of a base, left out of data overlays
 *
 * A template renders to `templates/<name>`. An overlay renders to
 * `overlays/<name>` and holds only the files of its own layers plus a
 * generated `package.json` that merges the fragments of its base and its
 * layers, so extracting it over a fresh base project leaves a complete one.
 */

/** @type {readonly string[]} */
export const WEB_FRAMEWORKS = ['next', 'vite'];

/** @type {readonly string[]} */
export const UI_LIBRARIES = ['antd', 'mui', 'heroui'];

/** @type {Record<string, string[]>} Standalone templates. */
export const recipes = {};

for (const framework of WEB_FRAMEWORKS) {
  recipes[framework] = [
    'source/web/common',
    `source/web/${framework}`,
    'source/ui/plain',
  ];
}

recipes.nest = ['source/server/common', 'source/server/node', 'source/server/nest'];
recipes.fastify = ['source/server/common', 'source/server/node', 'source/server/fastify'];
recipes.fastapi = ['source/server/common', 'source/server/fastapi'];
recipes.workspace = ['source/workspace'];

/**
 * The frameworks for which a library has a layer of its own, because a file
 * must differ there (the Next.js layout mounting a style registry). A library
 * with no entry for a framework is complete with its `common` layer alone.
 *
 * @type {Record<string, readonly string[]>}
 */
const FRAMEWORK_LAYERS = {
  antd: ['next'],
  mui: ['next'],
  heroui: [],
};

/** @type {Record<string, {base: string, layers: string[]}>} UI overlays. */
export const overlays = {};

for (const framework of WEB_FRAMEWORKS) {
  for (const ui of UI_LIBRARIES) {
    overlays[`${framework}-${ui}`] = {
      base: framework,
      layers: [
        `source/ui/${ui}/common`,
        ...(FRAMEWORK_LAYERS[ui].includes(framework)
          ? [`source/ui/${ui}/${framework}`]
          : []),
      ],
    };
  }
}

/**
 * The monorepo root for a server that has no contract package (FastAPI). It is
 * applied by monorepo.sh over the `workspace` template after `contract/` and
 * `docs/contract.md` are removed, and replaces the manifest, the workspace file
 * and the root documents, so those state only what exists. It lives under
 * `overlays/`, which keeps it out of a standalone `workspace` fetch.
 */
overlays['workspace-no-contract'] = {
  base: 'workspace',
  layers: ['source/workspace-no-contract'],
  fragmentLayers: ['source/workspace-no-contract'],
  agentsLayers: ['source/workspace-no-contract'],
};

/**
 * The frameworks that get data overlays, and the stores they can pair with.
 * A store is one word here and a set of layers under `source/data/<store>/`;
 * its kind is in STORE_TRAITS. Redis is not in DATA_STORES: it is the cache
 * and limiter store that pairs with each of them, or stands alone.
 *
 * @type {readonly string[]}
 */
export const DATA_FRAMEWORKS = [];

/** @type {readonly string[]} */
export const DATA_STORES = [];

/**
 * What a store needs from the layer structure: `sql` stores share the
 * `source/data/sql/<node|fastapi>` layer, and `server` stores need the compose
 * block that runs them (SQLite is a file and has none).
 *
 * @type {Readonly<Record<string, {sql: boolean, server: boolean}>>}
 */
export const STORE_TRAITS = {
  postgres: { sql: true, server: true },
  sqlite: { sql: true, server: false },
  redis: { sql: false, server: true },
};

/**
 * Generate the data overlay entries.
 *
 * Names are `<framework>-<store>`, `<framework>-<store>-redis` and
 * `<framework>-redis`, so the base is the part before the first dash. Layers
 * come in this order: the compose block when any chosen store is a server
 * store; the integration layer of the framework; per store its SQL layer (SQL
 * stores only), `common`, `node` on Node and the framework's own; the wiring
 * layer last. `agentsLayers` is the base's layers without `source/data/none`,
 * then the overlay's own.
 *
 * @param {Record<string, string[]>} baseRecipes The standalone templates.
 * @param {{frameworks: readonly string[], stores: readonly string[], redis: boolean}} options
 *   `redis` false leaves out every entry that includes Redis.
 * @returns {Record<string, {base: string, layers: string[], agentsLayers: string[]}>} Overlay entries.
 * @throws {Error} On a framework with no base recipe or a store with no traits.
 */
export function buildDataOverlays(baseRecipes, { frameworks, stores, redis }) {
  const entries = {};
  for (const framework of frameworks) {
    const baseLayers = baseRecipes[framework];
    if (!baseLayers) throw new Error(`data overlays: no base recipe for "${framework}"`);
    const node = framework !== 'fastapi';
    /** @type {string[][]} Each combination: the database store, if any, then redis. */
    const combos = [];
    for (const store of stores) {
      combos.push([store]);
      if (redis) combos.push([store, 'redis']);
    }
    if (redis) combos.push(['redis']);
    for (const combo of combos) {
      for (const store of combo) {
        if (!STORE_TRAITS[store]) throw new Error(`data overlays: no STORE_TRAITS entry for "${store}"`);
      }
      const layers = [];
      if (combo.some((store) => STORE_TRAITS[store].server)) layers.push('source/data/compose');
      layers.push(`source/data/integration/${framework}`);
      for (const store of combo) {
        if (STORE_TRAITS[store].sql) layers.push(`source/data/sql/${node ? 'node' : 'fastapi'}`);
        layers.push(`source/data/${store}/common`);
        if (node) layers.push(`source/data/${store}/node`);
        layers.push(`source/data/${store}/${framework}`);
      }
      const hasDatabase = combo[0] !== 'redis';
      const wiring = hasDatabase ? (combo.length > 1 ? 'database-redis' : 'database') : 'redis';
      layers.push(`source/data/wiring/${framework}/${wiring}`);
      entries[`${framework}-${combo.join('-')}`] = {
        base: framework,
        layers,
        agentsLayers: [...baseLayers.filter((layer) => layer !== 'source/data/none'), ...layers],
      };
    }
  }
  return entries;
}

/**
 * Name the overlays that must run against real services, one per layer
 * combination the others only repeat: `<framework>-<store>-redis` for a server
 * store, `<framework>-<store>` for a file store, and `<framework>-redis`.
 *
 * @param {{frameworks: readonly string[], stores: readonly string[], redis: boolean}} options As buildDataOverlays.
 * @returns {string[]} Overlay names.
 */
export function buildDataLive({ frameworks, stores, redis }) {
  const live = [];
  for (const framework of frameworks) {
    for (const store of stores) {
      const withRedis = redis && STORE_TRAITS[store]?.server;
      live.push(`${framework}-${store}${withRedis ? '-redis' : ''}`);
    }
    if (redis) live.push(`${framework}-redis`);
  }
  return live;
}

/**
 * List the layers of data overlays that no live overlay contains, so a layer
 * that never runs against a real store cannot ship unnoticed.
 *
 * @param {Record<string, {layers: string[]}>} dataEntries Generated data overlay entries.
 * @param {readonly string[]} live Names of the live overlays.
 * @returns {string[]} Sorted layers missing from every live overlay; also a live
 *   name that is not an entry, as `unknown live overlay: <name>`.
 */
export function uncoveredLayers(dataEntries, live) {
  const problems = live.filter((name) => !(name in dataEntries)).map((name) => `unknown live overlay: ${name}`);
  const covered = new Set(live.flatMap((name) => dataEntries[name]?.layers ?? []));
  const missing = new Set();
  for (const entry of Object.values(dataEntries)) {
    for (const layer of entry.layers) if (!covered.has(layer)) missing.add(layer);
  }
  return [...problems, ...[...missing].sort()];
}

/**
 * Whether the Redis entries are generated. The generator takes it as an
 * argument so a fixture can render the file-store overlays alone.
 */
const DATA_REDIS = false;

/** @type {Record<string, {base: string, layers: string[], agentsLayers: string[]}>} Data overlays. */
export const dataOverlays = buildDataOverlays(recipes, {
  frameworks: DATA_FRAMEWORKS,
  stores: DATA_STORES,
  redis: DATA_REDIS,
});

/** @type {string[]} The data overlays that run against real services. */
export const DATA_LIVE = buildDataLive({
  frameworks: DATA_FRAMEWORKS,
  stores: DATA_STORES,
  redis: DATA_REDIS,
});

Object.assign(overlays, dataOverlays);

export default recipes;
