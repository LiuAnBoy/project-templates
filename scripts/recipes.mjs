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
 *   server/<name>         one layer per backend
 *   workspace             the monorepo root with the contract package
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

recipes.nest = ['source/server/nest'];
recipes.fastify = ['source/server/fastify'];
recipes.fastapi = ['source/server/fastapi'];
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

export default recipes;
