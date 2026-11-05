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
 *   docker/main           the Docker block every template ships (.dockerignore, rules, env lines)
 *   docker/web            the env lines a web base adds (DOCKER_API_HOST, WEB_PORT)
 *   data/compose          the main compose block of a data overlay with a server store
 *   data/integration/<fw> integration test config of one backend
 *   data/sql/<node|fastapi>  what every SQL store shares on that platform
 *   data/<store>/common, node, <fw>  one store's layers
 *   data/redis/alone      the heading and notes of a project whose only store is Redis
 *   data/wiring/<fw>/<database|redis|database-redis>  the seam files, last
 *   data/none             the empty-store block of a base, left out of data overlays
 *
 * A template renders to `templates/<name>`. An overlay renders to
 * `overlays/<name>` and holds only the files of its own layers plus a
 * generated `package.json` that merges the fragments of its base and its
 * layers, so extracting it over a fresh base project leaves a complete one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DOCKER_FRAGMENT_NAMES } from './docker-blocks.mjs';

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
    'source/docker/main',
    'source/docker/web',
  ];
}

// The empty-store block comes last in a base and is left out of every data overlay.
// The Docker main block follows the framework's layers, so its text joins after the
// framework's H1 and block, and precedes the empty-store block.
recipes.nest = [
  'source/server/common',
  'source/server/node',
  'source/server/nest',
  'source/docker/main',
  'source/data/none',
];
recipes.fastify = [
  'source/server/common',
  'source/server/node',
  'source/server/fastify',
  'source/docker/main',
  'source/data/none',
];
recipes.fastapi = ['source/server/common', 'source/server/fastapi', 'source/docker/main', 'source/data/none'];
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
export const DATA_FRAMEWORKS = ['nest', 'fastify', 'fastapi'];

/** @type {readonly string[]} */
export const DATA_STORES = ['postgres', 'sqlite'];

/**
 * What a store needs from the layer structure: `sql` stores share the
 * `source/data/sql/<node|fastapi>` layer, `server` stores need the compose
 * block that runs them (SQLite is a file and has none), and a store that is
 * not a `database` (Redis) has an `alone` layer that gives a project with no
 * other store the heading and notes `docs/database.md` and `AGENTS.md` need.
 *
 * @type {Readonly<Record<string, {sql: boolean, server: boolean, database: boolean}>>}
 */
export const STORE_TRAITS = {
  postgres: { sql: true, server: true, database: true },
  sqlite: { sql: true, server: false, database: true },
  redis: { sql: false, server: true, database: false },
};

/**
 * Generate the data overlay entries.
 *
 * Names are `<framework>-<store>`, `<framework>-<store>-redis` and
 * `<framework>-redis`, so the base is the part before the first dash. Layers
 * come in this order: the compose block when any chosen store is a server
 * store; the integration layer of the framework; per store its SQL layer (SQL
 * stores only), `alone` (a store that is not a database, when it is the only
 * store), `common`, `node` on Node and the framework's own; the wiring layer
 * last. `agentsLayers` is the base's layers without `source/data/none`, then
 * the overlay's own.
 *
 * @param {Record<string, string[]>} baseRecipes The standalone templates.
 * @param {{frameworks: readonly string[], stores: readonly string[]}} options
 *   The frameworks, and the database stores each pairs with Redis.
 * @returns {Record<string, {base: string, layers: string[], agentsLayers: string[]}>} Overlay entries.
 * @throws {Error} On a framework with no base recipe or a store with no traits.
 */
export function buildDataOverlays(baseRecipes, { frameworks, stores }) {
  const entries = {};
  for (const framework of frameworks) {
    const baseLayers = baseRecipes[framework];
    if (!baseLayers) throw new Error(`data overlays: no base recipe for "${framework}"`);
    const node = framework !== 'fastapi';
    /** @type {string[][]} Each combination: the database store, if any, then redis. */
    const combos = [];
    for (const store of stores) combos.push([store], [store, 'redis']);
    combos.push(['redis']);
    for (const combo of combos) {
      for (const store of combo) {
        if (!STORE_TRAITS[store]) throw new Error(`data overlays: no STORE_TRAITS entry for "${store}"`);
      }
      const layers = [];
      if (combo.some((store) => STORE_TRAITS[store].server)) layers.push('source/data/compose');
      layers.push(`source/data/integration/${framework}`);
      for (const store of combo) {
        if (STORE_TRAITS[store].sql) layers.push(`source/data/sql/${node ? 'node' : 'fastapi'}`);
        if (!STORE_TRAITS[store].database && combo.length === 1) layers.push(`source/data/${store}/alone`);
        layers.push(`source/data/${store}/common`);
        if (node) layers.push(`source/data/${store}/node`);
        layers.push(`source/data/${store}/${framework}`);
      }
      const hasDatabase = STORE_TRAITS[combo[0]].database;
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
 * @param {{frameworks: readonly string[], stores: readonly string[]}} options As buildDataOverlays.
 * @returns {string[]} Overlay names.
 */
export function buildDataLive({ frameworks, stores }) {
  const live = [];
  for (const framework of frameworks) {
    for (const store of stores) {
      live.push(`${framework}-${store}${STORE_TRAITS[store]?.server ? '-redis' : ''}`);
    }
    live.push(`${framework}-redis`);
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

/** @type {Record<string, {base: string, layers: string[], agentsLayers: string[]}>} Data overlays. */
export const dataOverlays = buildDataOverlays(recipes, {
  frameworks: DATA_FRAMEWORKS,
  stores: DATA_STORES,
});

/** @type {string[]} The data overlays that run against real services. */
export const DATA_LIVE = buildDataLive({
  frameworks: DATA_FRAMEWORKS,
  stores: DATA_STORES,
});

/**
 * Name the targets that `check-docker.sh` builds and runs: the templates and
 * overlays named outright, then `<framework>-<store>` for each pair, with
 * `-redis` for a server store, as `buildDataLive` does, but with no Redis-only
 * entry.
 *
 * @param {{named?: readonly string[], frameworks: readonly string[], stores: readonly string[]}} options
 *   `named` are the targets listed by hand; the rest are generated from the
 *   frameworks and the database stores.
 * @returns {string[]} Target names.
 */
export function buildDockerLive({ named = [], frameworks, stores }) {
  const live = [...named];
  for (const framework of frameworks) {
    for (const store of stores) {
      live.push(`${framework}-${store}${STORE_TRAITS[store]?.server ? '-redis' : ''}`);
    }
  }
  return live;
}

/**
 * List the layers that hold a Docker fragment.
 *
 * @param {string} root Repository root.
 * @param {Iterable<string>} layers Layer paths relative to the root.
 * @returns {string[]} The sorted layers with at least one Docker fragment file.
 */
export function dockerFragmentLayers(root, layers) {
  return [...new Set(layers)]
    .filter((layer) => DOCKER_FRAGMENT_NAMES.some((name) => fs.existsSync(path.join(root, layer, name))))
    .sort();
}

/**
 * List the Docker fragment layers that no live Docker target contains, so a
 * layer that never builds into an image cannot ship unnoticed.
 *
 * @param {Record<string, string[]>} targets Every template and overlay, to the
 *   layers its output is joined from.
 * @param {readonly string[]} live Names of the live Docker targets.
 * @param {readonly string[]} dockerLayers Layers holding a Docker fragment.
 * @returns {string[]} Layers in no live target, sorted; also a live name that is
 *   not a target, as `unknown live target: <name>`.
 */
export function uncoveredDockerLayers(targets, live, dockerLayers) {
  const problems = live.filter((name) => !(name in targets)).map((name) => `unknown live target: ${name}`);
  const covered = new Set(live.flatMap((name) => targets[name] ?? []));
  return [...problems, ...[...dockerLayers].filter((layer) => !covered.has(layer)).sort()];
}

/**
 * The targets that run as images: the standalone templates and the UI overlay named
 * outright, then `nest` and `fastapi` with each database store, as
 * `buildDockerLive` generates them. `test-render.mjs` fails when a layer holding a
 * Docker fragment is in none of them.
 *
 * @type {string[]}
 */
export const DOCKER_LIVE = buildDockerLive({
  named: ['fastify', 'next', 'vite', 'next-heroui'],
  frameworks: ['nest', 'fastapi'],
  stores: DATA_STORES,
});

Object.assign(overlays, dataOverlays);

export default recipes;
