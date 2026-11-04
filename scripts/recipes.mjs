/**
 * Recipes: the ordered source layers that make up each standalone template.
 *
 * Layer paths are relative to the repository root. Later layers override
 * earlier ones file by file, and their `package.fragment.json` is deep-merged
 * over the earlier fragments (see render.mjs).
 *
 * Layout of `source/`:
 *   web/common            files shared by every web template
 *   web/next, web/vite    framework layer
 *   ui/plain              the no-UI-library variant (one layer)
 *   ui/<lib>/common       part shared by both frameworks (antd, mui, heroui)
 *   ui/<lib>/<framework>  part that only one framework needs
 *   server/<name>         one layer per backend
 *   workspace             the monorepo root with the contract package
 */

/** @type {readonly string[]} */
export const WEB_FRAMEWORKS = ['next', 'vite'];

/** @type {readonly string[]} */
export const UI_LIBRARIES = ['plain', 'antd', 'mui', 'heroui'];

/**
 * Build the layer list of one web template.
 *
 * @param {string} framework One of WEB_FRAMEWORKS.
 * @param {string} ui One of UI_LIBRARIES.
 * @returns {string[]} Ordered layer directories.
 */
function webLayers(framework, ui) {
  const uiLayers =
    ui === 'plain'
      ? ['source/ui/plain']
      : [`source/ui/${ui}/common`, `source/ui/${ui}/${framework}`];
  return ['source/web/common', `source/web/${framework}`, ...uiLayers];
}

/** @type {Record<string, string[]>} */
export const recipes = {};

for (const framework of WEB_FRAMEWORKS) {
  for (const ui of UI_LIBRARIES) {
    recipes[`${framework}-${ui}`] = webLayers(framework, ui);
  }
}

recipes.nest = ['source/server/nest'];
recipes.fastify = ['source/server/fastify'];
recipes.fastapi = ['source/server/fastapi'];
recipes.workspace = ['source/workspace'];

export default recipes;
