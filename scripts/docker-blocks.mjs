#!/usr/bin/env node
/**
 * The Docker joins: the compose files, the Dockerfile and the `.dockerignore`
 * that `render.mjs` builds from the fragments of the layers, and the guards
 * that `test-render.mjs` runs over them. Node standard library only.
 *
 * Fragments (a layer holds any of these next to its other files):
 *   compose.fragment.yml           a store service for `docker-compose.dev.yml` and
 *                                  `docker-compose.yml`; top-level keys `services`
 *                                  and `volumes`; no `build`, `restart` or
 *                                  `container_name` on a service
 *   compose.app.fragment.yml       an app service, or the main block, for
 *                                  `docker-compose.yml`; top-level keys `services`,
 *                                  `volumes` and `networks`; no `container_name`.
 *                                  The one block with no `services` key is the main
 *                                  block: its leading comment is the file header
 *   compose.server.fragment.yml    how a store reaches the app: lines under
 *                                  `environment`, `depends_on` and `volumes` of the
 *                                  services `server` and `migrate`, plus top-level
 *                                  `volumes`
 *   Dockerfile.build.fragment,
 *   Dockerfile.runtime.fragment    text put at the marker line `# docker-fragment: build`
 *                                  or `# docker-fragment: runtime` of the Dockerfile
 *   dockerignore.fragment          lines appended to `.dockerignore`
 *
 * Shapes the compose joins accept: services at the file's one key indent, a
 * service's own keys one indent deeper, `environment` and `depends_on` as maps,
 * `volumes` as a list. A service written inline (`name: {}`) cannot take
 * contributions.
 */
import fs from 'node:fs';
import path from 'node:path';

export const COMPOSE_FRAGMENT = 'compose.fragment.yml';
export const COMPOSE_APP_FRAGMENT = 'compose.app.fragment.yml';
export const COMPOSE_SERVER_FRAGMENT = 'compose.server.fragment.yml';
export const DOCKERFILE_FRAGMENTS = {
  build: 'Dockerfile.build.fragment',
  runtime: 'Dockerfile.runtime.fragment',
};
export const DOCKERIGNORE_FRAGMENT = 'dockerignore.fragment';
/** Every Docker fragment name: never copied into a rendered target. */
export const DOCKER_FRAGMENT_NAMES = [
  COMPOSE_APP_FRAGMENT,
  COMPOSE_SERVER_FRAGMENT,
  DOCKERFILE_FRAGMENTS.build,
  DOCKERFILE_FRAGMENTS.runtime,
  DOCKERIGNORE_FRAGMENT,
];
/** The line of `docker-compose.yml` that names the project; the join alone writes it. */
export const COMPOSE_NAME_LINE = 'name: ${COMPOSE_PROJECT_NAME:?set COMPOSE_PROJECT_NAME in .env}';
/** The marker line of each Dockerfile fragment. */
export const DOCKERFILE_MARKERS = {
  build: '# docker-fragment: build',
  runtime: '# docker-fragment: runtime',
};
/** The only build arguments an image may take; every other value is read at runtime. */
export const ALLOWED_BUILD_ARGS = ['API_HOST', 'PART'];
/** The patterns every `.dockerignore` must hold. */
export const REQUIRED_IGNORES = ['**/.env', '**/node_modules', 'todos'];

const SERVER_SERVICES = ['server', 'migrate'];
const SERVER_KEYS = ['environment', 'depends_on', 'volumes'];
const KEY_LINE = /^\s*([A-Za-z_][A-Za-z0-9_.-]*):(.*)$/;

/**
 * Collect the blocks of one fragment name across the layers, in order. Leading
 * blank lines and trailing whitespace of a block are cut; its first line keeps
 * its indentation, which a Makefile recipe needs.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @param {string} fragment Fragment file name.
 * @returns {string[]} The non-empty blocks.
 */
export function collectFragments(layerDirs, fragment) {
  const parts = [];
  for (const dir of layerDirs) {
    const file = path.join(dir, fragment);
    if (!fs.existsSync(file)) continue;
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/^(?:[ \t]*\r?\n)+/, '')
      .replace(/\s+$/, '');
    if (text !== '') parts.push(text);
  }
  return parts;
}

/**
 * Check whether a line is blank or a comment.
 *
 * @param {string} line One line.
 * @returns {boolean} True when it carries no YAML content.
 */
function skippable(line) {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

/**
 * Measure a line's indentation.
 *
 * @param {string} line One line.
 * @returns {number} The count of leading spaces and tabs.
 */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * Parse one compose block into its top-level sections.
 *
 * @param {string} file Absolute path of the block.
 * @param {string[]} allowed The top-level keys the block may hold.
 * @returns {{lead: string[], parts: Array<{key: string, body: string[]}>}} The
 *   comment lines before the first key (a file with no key is all lead), and
 *   each section's body in file order.
 * @throws {Error} On another top-level key, a key that does not open an
 *   indented block, a key repeated, or a stray unindented line.
 */
function parseBlock(file, allowed) {
  const lead = [];
  /** @type {string[] | null} */
  let current = null;
  const parts = [];
  const keys = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const key = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(line);
    if (key) {
      if (!allowed.includes(key[1])) {
        const list = `${allowed.slice(0, -1).join(', ')} and ${allowed.at(-1)}`;
        throw new Error(
          `${file}: top-level key "${key[1]}" is not allowed in a compose block (only ${list})`,
        );
      }
      const value = (key[2] ?? '').replace(/(^|\s)#.*$/, '').trim();
      if (value !== '' && value !== '{}') {
        throw new Error(`${file}: "${key[1]}:" must open an indented block, found "${value}"`);
      }
      if (keys.has(key[1])) throw new Error(`${file}: top-level key "${key[1]}" appears twice`);
      keys.add(key[1]);
      current = [];
      parts.push({ key: key[1], body: current });
      continue;
    }
    if (line.trim() === '' || line.startsWith('#') || /^\s/.test(line)) {
      if (current === null) lead.push(line);
      else current.push(line);
      continue;
    }
    throw new Error(`${file}: unexpected top-level line in a compose block: ${line}`);
  }
  return { lead, parts };
}

/**
 * Keep a block's leading comment with the first section that follows it, for a
 * block that is not the main block and so has no header to give it to.
 *
 * @param {{lead: string[], parts: Array<{key: string, body: string[]}>}} parsed Result of `parseBlock`.
 * @returns {Array<{key: string, body: string[]}>} The sections.
 */
function withLead({ lead, parts }) {
  if (parts.length > 0) parts[0].body.unshift(...lead);
  return parts;
}

/**
 * List the direct keys of every service in one section body.
 *
 * @param {string[]} body The lines under `services:`.
 * @returns {Array<{service: string, key: string}>} Each service's own keys.
 */
function serviceKeys(body) {
  const out = [];
  let keyIndent = null;
  let childIndent = null;
  let service = null;
  for (const line of body) {
    if (skippable(line)) continue;
    const indent = indentOf(line);
    keyIndent ??= indent;
    if (indent === keyIndent) {
      service = KEY_LINE.exec(line)?.[1] ?? null;
      childIndent = null;
      continue;
    }
    if (service === null) continue;
    childIndent ??= indent;
    if (indent === childIndent) {
      const key = KEY_LINE.exec(line)?.[1];
      if (key) out.push({ service, key });
    }
  }
  return out;
}

/**
 * Fail on a service key a block kind may not use.
 *
 * @param {string[]} body The lines under `services:`.
 * @param {string[]} banned Keys the kind forbids.
 * @param {string} file Block file, for the message.
 * @param {string} kind Block kind, for the message.
 * @returns {void}
 * @throws {Error} Naming the service and the key.
 */
function banServiceKeys(body, banned, file, kind) {
  for (const { service, key } of serviceKeys(body)) {
    if (banned.includes(key)) {
      throw new Error(`${file}: service "${service}" of ${kind} sets "${key}", which ${kind} may not set`);
    }
  }
}

/**
 * Join the bodies of one section, checking that no name is defined twice.
 *
 * @param {string[][]} bodies The section bodies of each block, in order.
 * @param {string} kind Section name (`services`, `volumes`, `networks`).
 * @param {Set<string>} seen Names defined so far in this section.
 * @returns {string[] | null} The joined lines, or null when empty.
 * @throws {Error} On a name defined twice.
 */
function joinSection(bodies, kind, seen) {
  const trimmed = bodies.map((body) => {
    const lines = [...body];
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    return lines;
  });
  const indent = trimmed
    .flat()
    .map((line) => /^(\s+)[^\s#]/.exec(line))
    .find((match) => match);
  const keyIndent = indent ? indent[1].match(/^\s*/)[0] : '  ';
  for (const lines of trimmed) {
    const own = lines
      .map((line) => /^(\s+)([A-Za-z0-9_.-]+):/.exec(line))
      .filter((match) => match && match[1] === keyIndent);
    for (const match of own) {
      if (seen.has(match[2])) throw new Error(`compose: ${kind.slice(0, -1)} "${match[2]}" is defined twice`);
      seen.add(match[2]);
    }
  }
  const lines = trimmed.flat();
  return lines.length === 0 ? null : lines;
}

/**
 * Assemble the compose file text from its parts.
 *
 * @param {string[]} header The file's leading comment lines.
 * @param {Array<[string, string[] | null]>} sections Section name and joined lines.
 * @param {string | null} name The `name:` line, or null.
 * @returns {string} The file, ending in one newline.
 */
function assemble(header, sections, name) {
  const head = header.join('\n').replace(/^\s+|\s+$/g, '');
  const blocks = sections
    .filter(([, lines]) => lines !== null)
    .map(([key, lines]) => [`${key}:`, ...lines].join('\n'));
  return `${[head === '' ? null : head, name, ...blocks].filter((part) => part !== null && part !== '').join('\n\n')}\n`;
}

/**
 * Join the store blocks of the layers into the dev compose file by section.
 * The first block found is the main block, whose leading comment is the header.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @returns {string | null} The compose file, or null when no layer has a block.
 * @throws {Error} On a top-level key other than `services` and `volumes`, a
 *   service that sets `build`, `restart` or `container_name`, a key repeated
 *   inside a block, a line that is neither a key, a comment nor indented, a
 *   service or volume named twice, or blocks that define no service.
 */
export function buildCompose(layerDirs) {
  const bodies = { services: [], volumes: [] };
  let header = [];
  let seenFragment = false;
  for (const dir of layerDirs) {
    const file = path.join(dir, COMPOSE_FRAGMENT);
    if (!fs.existsSync(file)) continue;
    const isMain = !seenFragment;
    seenFragment = true;
    const parsed = parseBlock(file, ['services', 'volumes']);
    // The main block's leading comment is the file header.
    if (isMain) header = parsed.lead;
    for (const part of isMain ? parsed.parts : withLead(parsed)) {
      if (part.key === 'services') {
        banServiceKeys(part.body, ['build', 'restart', 'container_name'], file, 'a store block');
      }
      bodies[part.key].push(part.body);
    }
  }
  if (!seenFragment) return null;
  const services = joinSection(bodies.services, 'services', new Set());
  if (services === null) throw new Error('compose fragments define no service');
  const volumes = joinSection(bodies.volumes, 'volumes', new Set());
  return assemble(header, [['services', services], ['volumes', volumes]], null);
}

/**
 * Locate a service in the joined services lines.
 *
 * @param {string[]} lines The lines under `services:`.
 * @param {string} name Service name.
 * @returns {{start: number, end: number, child: number, unit: number, keyIndent: number}}
 *   The service's header line, the end of its content (exclusive, trailing
 *   comments and blank lines left out), its children's indent and one indent step.
 * @throws {Error} When the service is missing, written inline, or has no body.
 */
function findService(lines, name) {
  const keyIndent = indentOf(lines.find((line) => !skippable(line)) ?? '');
  const starts = [];
  lines.forEach((line, i) => {
    if (skippable(line) || indentOf(line) !== keyIndent) return;
    const match = KEY_LINE.exec(line);
    if (match) starts.push({ name: match[1], start: i, rest: match[2].replace(/(^|\s)#.*$/, '').trim() });
  });
  const at = starts.findIndex((entry) => entry.name === name);
  if (at === -1) throw new Error(`compose: service "${name}" is not defined, so nothing can be added to it`);
  if (starts[at].rest !== '') throw new Error(`compose: service "${name}" must be written as a block`);
  const start = starts[at].start;
  let end = at + 1 < starts.length ? starts[at + 1].start : lines.length;
  while (end > start + 1 && skippable(lines[end - 1])) end -= 1;
  const first = lines.slice(start + 1, end).find((line) => !skippable(line));
  if (first === undefined) throw new Error(`compose: service "${name}" has no body`);
  const child = indentOf(first);
  return { start, end, child, unit: child - keyIndent > 0 ? child - keyIndent : 2, keyIndent };
}

/**
 * List the direct keys of one located service.
 *
 * @param {string[]} lines The lines under `services:`.
 * @param {{start: number, end: number, child: number}} range The service.
 * @returns {Array<{key: string, line: number, rest: string}>} Its keys in order.
 */
function directKeys(lines, range) {
  const out = [];
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (skippable(lines[i]) || indentOf(lines[i]) !== range.child) continue;
    const match = KEY_LINE.exec(lines[i]);
    if (match) out.push({ key: match[1], line: i, rest: match[2].replace(/(^|\s)#.*$/, '').trim() });
  }
  return out;
}

/**
 * Identify an entry of an `environment`, `depends_on` or `volumes` block.
 *
 * @param {string} line An entry line.
 * @returns {string} The key of a map entry, or the text of a list item.
 */
function entryId(line) {
  const text = line.trim();
  if (text.startsWith('- ')) return text;
  return text.split(':')[0];
}

/**
 * Add lines under one key of a service, creating the key when it is absent.
 *
 * @param {string[]} lines The lines under `services:`, edited in place.
 * @param {string} service Service name.
 * @param {string} key `environment`, `depends_on` or `volumes`.
 * @param {string[]} add The lines to add, with the shallowest at indent 0.
 * @returns {void}
 * @throws {Error} When the key is written inline or an entry ends up twice.
 */
function addUnderKey(lines, service, key, add) {
  const range = findService(lines, service);
  const found = directKeys(lines, range).find((entry) => entry.key === key);
  const pad = (n) => ' '.repeat(n);
  if (!found) {
    const body = add.map((line) => (line === '' ? '' : `${pad(range.child + range.unit)}${line}`));
    lines.splice(range.end, 0, `${pad(range.child)}${key}:`, ...body);
  } else {
    if (found.rest !== '') throw new Error(`compose: ${key} of service "${service}" must be written as a block`);
    let end = range.end;
    const next = directKeys(lines, range).find((entry) => entry.line > found.line);
    if (next) {
      end = next.line;
      while (end > found.line + 1 && skippable(lines[end - 1])) end -= 1;
    }
    const first = lines.slice(found.line + 1, end).find((line) => !skippable(line));
    const target = first === undefined ? range.child + range.unit : indentOf(first);
    lines.splice(end, 0, ...add.map((line) => (line === '' ? '' : `${pad(target)}${line}`)));
  }
  // An entry named twice in one key is a conflict between two layers.
  const again = findService(lines, service);
  const own = directKeys(lines, again).find((entry) => entry.key === key);
  const after = directKeys(lines, again).find((entry) => entry.line > own.line);
  const stop = after ? after.line : again.end;
  const entries = lines.slice(own.line + 1, stop).filter((line) => !skippable(line));
  const indent = indentOf(entries[0] ?? '');
  const ids = entries.filter((line) => indentOf(line) === indent).map(entryId);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup !== undefined) throw new Error(`compose: ${key} of service "${service}" lists "${dup}" twice`);
}

/**
 * Parse a `compose.server.fragment.yml` services body into contributions.
 *
 * @param {string[]} body The lines under `services:`.
 * @param {string} file The fragment, for messages.
 * @returns {Array<{service: string, key: string, lines: string[]}>} What to add where.
 * @throws {Error} On a service other than `server` and `migrate`, or a key other
 *   than `environment`, `depends_on` and `volumes`.
 */
function parseContributions(body, file) {
  const out = [];
  let keyIndent = null;
  let child = null;
  let service = null;
  /** @type {{service: string, key: string, lines: string[]} | null} */
  let current = null;
  for (const line of body) {
    if (skippable(line)) {
      current?.lines.push(line);
      continue;
    }
    const indent = indentOf(line);
    keyIndent ??= indent;
    if (indent === keyIndent) {
      const match = KEY_LINE.exec(line);
      if (!match) throw new Error(`${file}: unexpected line under services: ${line}`);
      if (!SERVER_SERVICES.includes(match[1])) {
        throw new Error(`${file}: service "${match[1]}" is not allowed (only ${SERVER_SERVICES.join(' and ')})`);
      }
      if (match[2].trim() !== '') throw new Error(`${file}: service "${match[1]}" must be written as a block`);
      service = match[1];
      child = null;
      current = null;
      continue;
    }
    child ??= indent;
    if (indent === child) {
      const match = KEY_LINE.exec(line);
      if (!match) throw new Error(`${file}: unexpected line under ${service}: ${line}`);
      if (!SERVER_KEYS.includes(match[1])) {
        throw new Error(`${file}: "${match[1]}" of ${service} is not allowed (only ${SERVER_KEYS.join(', ')})`);
      }
      if (match[2].trim() !== '') throw new Error(`${file}: "${match[1]}" of ${service} must be written as a block`);
      current = { service, key: match[1], lines: [] };
      out.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return out.map((entry) => {
    const lines = [...entry.lines];
    while (lines.length > 0 && skippable(lines[lines.length - 1])) lines.pop();
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    const base = indentOf(lines.find((line) => !skippable(line)) ?? '');
    return { ...entry, lines: lines.map((line) => (line.length >= base ? line.slice(base) : '')) };
  });
}

/**
 * Remove a service's dependency on itself from a `depends_on` contribution.
 *
 * @param {string[]} lines The contribution lines, shallowest at indent 0.
 * @param {string} service The service that receives them.
 * @returns {string[]} The lines without the entry that names the service.
 */
function dropSelfDependency(lines, service) {
  const out = [];
  let dropping = false;
  for (const line of lines) {
    if (!skippable(line) && indentOf(line) === 0) {
      const text = line.trim();
      dropping = (text.startsWith('-') ? text.replace(/^-\s*/, '') : text.split(':')[0]).trim() === service;
    }
    if (!dropping) out.push(line);
  }
  return out;
}

/**
 * Join the compose blocks of the layers into the whole project compose file.
 *
 * It reads `compose.fragment.yml` (store services), `compose.app.fragment.yml`
 * (app services; the one block with no `services` key is the main block, whose
 * leading comment is the header and which heads the file wherever its layer
 * stands) and `compose.server.fragment.yml` (lines added under `server` and
 * `migrate`). It writes `name:` itself, drops a service's dependency on itself,
 * and adds `restart: unless-stopped` to every service that states no restart.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @returns {string | null} The compose file, or null when no layer has an app block.
 * @throws {Error} On the failures of `buildCompose`; a store block or an app
 *   block with a key it may not set; a top-level `name:`; no main block or two;
 *   a contribution to a service the file does not define; an entry named twice.
 */
export function buildAppCompose(layerDirs) {
  /** @type {Array<{main: boolean, services: string[][], volumes: string[][], networks: string[][]}>} */
  const blocks = [];
  const mains = [];
  const contributions = [];
  let header = [];
  let anyApp = false;
  for (const dir of layerDirs) {
    const block = { main: false, services: [], volumes: [], networks: [] };
    const store = path.join(dir, COMPOSE_FRAGMENT);
    if (fs.existsSync(store)) {
      for (const part of withLead(parseBlock(store, ['services', 'volumes']))) {
        if (part.key === 'services') {
          banServiceKeys(part.body, ['build', 'restart', 'container_name'], store, 'a store block');
        }
        block[part.key].push(part.body);
      }
    }
    const app = path.join(dir, COMPOSE_APP_FRAGMENT);
    if (fs.existsSync(app)) {
      anyApp = true;
      const parsed = parseBlock(app, ['services', 'volumes', 'networks']);
      const isMain = !parsed.parts.some((part) => part.key === 'services');
      if (isMain) {
        block.main = true;
        mains.push(app);
        header = parsed.lead;
      }
      for (const part of isMain ? parsed.parts : withLead(parsed)) {
        if (part.key === 'services') banServiceKeys(part.body, ['container_name'], app, 'an app block');
        block[part.key].push(part.body);
      }
    }
    const server = path.join(dir, COMPOSE_SERVER_FRAGMENT);
    if (fs.existsSync(server)) {
      for (const part of withLead(parseBlock(server, ['services', 'volumes']))) {
        if (part.key === 'services') contributions.push(...parseContributions(part.body, server));
        else block.volumes.push(part.body);
      }
    }
    blocks.push(block);
  }
  if (!anyApp) return null;
  if (mains.length === 0) {
    throw new Error('docker-compose.yml has no main block: one compose.app.fragment.yml must hold no services key');
  }
  if (mains.length > 1) {
    throw new Error(`docker-compose.yml has two main blocks (no services key): ${mains.join(', ')}`);
  }
  const ordered = [...blocks.filter((b) => b.main), ...blocks.filter((b) => !b.main)];
  const services = joinSection(blocks.flatMap((b) => b.services), 'services', new Set());
  if (services === null) throw new Error('compose fragments define no service');
  for (const { service, key, lines } of contributions) {
    const add = key === 'depends_on' ? dropSelfDependency(lines, service) : lines;
    if (add.some((line) => !skippable(line))) addUnderKey(services, service, key, add);
    else findService(services, service);
  }
  const names = [];
  const keyIndent = indentOf(services.find((line) => !skippable(line)) ?? '');
  for (const line of services) {
    if (!skippable(line) && indentOf(line) === keyIndent) names.push(KEY_LINE.exec(line)[1]);
  }
  for (const name of names) {
    const range = findService(services, name);
    if (directKeys(services, range).some((entry) => entry.key === 'restart')) continue;
    services.splice(range.end, 0, `${' '.repeat(range.child)}restart: unless-stopped`);
  }
  const volumes = joinSection(ordered.flatMap((b) => b.volumes), 'volumes', new Set());
  const networks = joinSection(ordered.flatMap((b) => b.networks), 'networks', new Set());
  return assemble(header, [['services', services], ['volumes', volumes], ['networks', networks]], COMPOSE_NAME_LINE);
}

/**
 * Fill the marker lines of a Dockerfile with the fragments of the layers.
 *
 * A marker line is replaced by its block; with no block it is removed, and a
 * marker never reaches the output.
 *
 * @param {string} text The Dockerfile with `# docker-fragment: build` and
 *   `# docker-fragment: runtime` marker lines.
 * @param {{build?: string | null, runtime?: string | null}} blocks The joined fragments.
 * @param {string} [label] Name of the file, for messages.
 * @returns {string} The Dockerfile.
 * @throws {Error} On a block with no marker line, a marker line twice, or a
 *   `# docker-fragment:` line of another kind.
 */
export function fillDockerfile(text, blocks, label = 'Dockerfile') {
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('# docker-fragment:') && !Object.values(DOCKERFILE_MARKERS).includes(t)) {
      throw new Error(`${label}: unknown marker line "${t}"`);
    }
  }
  for (const kind of Object.keys(DOCKERFILE_MARKERS)) {
    const count = lines.filter((line) => line.trim() === DOCKERFILE_MARKERS[kind]).length;
    if (count > 1) throw new Error(`${label}: marker "${DOCKERFILE_MARKERS[kind]}" appears ${count} times`);
    if (count === 0 && blocks[kind]) {
      throw new Error(`${label}: a ${kind} fragment exists but the file has no "${DOCKERFILE_MARKERS[kind]}" line`);
    }
  }
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const kind = Object.keys(DOCKERFILE_MARKERS).find((k) => lines[i].trim() === DOCKERFILE_MARKERS[k]);
    if (kind === undefined) {
      out.push(lines[i]);
    } else if (blocks[kind]) {
      out.push(...blocks[kind].split('\n'));
    } else if (out.length > 0 && out[out.length - 1] === '' && lines[i + 1] === '') {
      i += 1;
    }
  }
  return out.join('\n');
}

/**
 * Read the Dockerfile fragments of the layers, joined per kind.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @returns {{build: string | null, runtime: string | null}} One block per kind.
 */
export function readDockerfileFragments(layerDirs) {
  const join = (name) => {
    const parts = collectFragments(layerDirs, name);
    return parts.length === 0 ? null : parts.join('\n');
  };
  return { build: join(DOCKERFILE_FRAGMENTS.build), runtime: join(DOCKERFILE_FRAGMENTS.runtime) };
}

/**
 * Append the fragments' lines to a `.dockerignore`, leaving out patterns it has.
 *
 * @param {string} text The base `.dockerignore`.
 * @param {string[]} fragments The fragment texts in layer order.
 * @returns {string} The new content, ending in one newline.
 */
export function joinDockerignore(text, fragments) {
  const present = new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
  const added = [];
  for (const fragment of fragments) {
    for (const raw of fragment.split('\n')) {
      const line = raw.trim();
      if (line === '') {
        if (added.length > 0 && added[added.length - 1] !== '') added.push('');
      } else if (line.startsWith('#')) {
        added.push(line);
      } else if (!present.has(line)) {
        present.add(line);
        added.push(line);
      }
    }
  }
  while (added.length > 0 && added[added.length - 1] === '') added.pop();
  return `${text.replace(/\s+$/, '')}\n${added.map((line) => `${line}\n`).join('')}`;
}

/**
 * Find the build arguments a Dockerfile or compose text declares, other than the allowed.
 *
 * A Dockerfile is read as Docker does: comment and blank lines are dropped, then
 * continuation lines are joined, then every name of every `ARG` is read. A
 * compose `args:` must be a block, a list or a mapping with one entry per line;
 * a flow form (`args: [...]`, `args: {...}`) fails.
 *
 * @param {string} text A Dockerfile or a compose file.
 * @param {string} label Name of the file, for messages.
 * @param {readonly string[]} [allowed] Permitted argument names.
 * @returns {string[]} One message per forbidden argument or flow-form `args:`.
 */
export function checkBuildArgs(text, label, allowed = ALLOWED_BUILD_ARGS) {
  const names = [];
  const problems = [];
  const lines = text.split('\n');
  const joined = lines
    .filter((line) => !skippable(line))
    .join('\n')
    .replace(/\\[ \t]*\n/g, ' ');
  for (const line of joined.split('\n')) {
    const arg = /^\s*ARG\s+(.*)$/i.exec(line);
    if (!arg) continue;
    for (const m of arg[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)(?:=(?:"[^"]*"|'[^']*'|\S*))?/g)) names.push(m[1]);
  }
  lines.forEach((line, i) => {
    const compose = /^(\s*)args:\s*(.*)$/.exec(line);
    if (!compose) return;
    if (compose[2].replace(/(^|\s)#.*$/, '').trim() !== '') {
      problems.push(`${label}: args: must be a block, one entry per line, not a flow form`);
      return;
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      if (skippable(lines[j])) continue;
      if (indentOf(lines[j]) <= compose[1].length) break;
      const entry = /^\s*(?:-\s*)?["']?([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[j]);
      if (entry) names.push(entry[1]);
    }
  });
  return [
    ...problems,
    ...names
      .filter((name) => !allowed.includes(name))
      .map((name) => `${label}: build argument ${name} is not allowed (only ${allowed.join(', ')})`),
  ];
}

/**
 * Check that a `.dockerignore` lists `.env` files, `node_modules` at any depth, and `todos` at the root only (a deeper `todos` may be a source folder),
 * and holds no `!` line except `!.env.example` and `!**\/.env.example`. A file
 * that needs another negation changes this rule on purpose.
 *
 * @param {string} text The `.dockerignore`.
 * @param {string} label Name of the file, for messages.
 * @returns {string[]} One message per missing pattern or other negation.
 */
export function checkDockerignore(text, label) {
  const lines = text.split('\n').map((line) => line.trim());
  return [
    ...REQUIRED_IGNORES.filter((pattern) => !lines.includes(pattern)).map(
      (pattern) => `${label}: .dockerignore lacks ${pattern}`,
    ),
    ...lines
      .filter((line) => line.startsWith('!') && line !== '!.env.example' && line !== '!**/.env.example')
      .map((line) => `${label}: .dockerignore negation ${line} is not allowed (only !.env.example)`),
  ];
}

/**
 * Check that every `FROM node:<major>` of a Dockerfile matches `.nvmrc`.
 *
 * @param {string} dockerfile The Dockerfile.
 * @param {string} nvmrc The `.nvmrc` content, such as `24` or `v24.1.0`.
 * @param {string} label Name of the Dockerfile, for messages.
 * @returns {string[]} One message per image whose major differs.
 */
export function checkNodeMajor(dockerfile, nvmrc, label) {
  const want = /(\d+)/.exec(nvmrc)?.[1];
  const problems = [];
  for (const line of dockerfile.split('\n')) {
    const from = /^\s*FROM\s+(?:--platform=\S+\s+)?node:(\d+)/i.exec(line);
    if (from && from[1] !== want) {
      problems.push(`${label}: FROM node:${from[1]} differs from .nvmrc major ${want}`);
    }
  }
  return problems;
}

/**
 * Check that the final stage of a Dockerfile runs as a numeric uid other than 0.
 *
 * A `USER` instruction counts only inside the stage it appears in, so the user
 * is reset at every `FROM` and a `USER` of an earlier stage never makes a root
 * final stage pass.
 *
 * @param {string} dockerfile The Dockerfile.
 * @param {string} label Name of the Dockerfile, for messages.
 * @returns {string[]} A message when the final stage has no `USER`, or its last
 *   `USER` is not numeric or is 0.
 */
export function checkFinalUser(dockerfile, label) {
  let last;
  for (const line of dockerfile.split('\n')) {
    if (/^\s*FROM\s/i.test(line)) last = undefined;
    const user = /^\s*USER\s+(\S+)/i.exec(line)?.[1];
    if (user !== undefined) last = user;
  }
  if (last === undefined) return [`${label}: no USER instruction in the final stage, so the image runs as root`];
  const match = /^(\d+)(?::\d+)?$/.exec(last);
  if (!match || Number(match[1]) === 0) {
    return [`${label}: the last USER is "${last}", expected a numeric uid other than 0`];
  }
  return [];
}

/** The services that face outward and so read no `env_file`. */
export const WEB_SERVICES = ['web', 'dashboard'];

/**
 * Check that no web service of a compose file sets `env_file`. A root `.env` holds
 * the server's credentials, and the web containers are the ones that face outward,
 * so their values come from build arguments and `environment` alone.
 *
 * @param {string} text A compose file.
 * @param {string} label Name of the file, for messages.
 * @returns {string[]} One message per web service that sets `env_file`.
 */
export function checkWebEnvFile(text, label) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^services:/.test(line));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i]) && !lines[i].startsWith('#')) {
      end = i;
      break;
    }
  }
  return serviceKeys(lines.slice(start + 1, end))
    .filter(({ service, key }) => WEB_SERVICES.includes(service) && key === 'env_file')
    .map(({ service }) => `${label}: service ${service} sets env_file, but a web service reads none`);
}

/**
 * Check that a compose file holds exactly one top-level `services` key.
 *
 * @param {string} text A compose file.
 * @param {string} label Name of the file, for messages.
 * @returns {string[]} A message when the count is not one.
 */
export function checkOneServices(text, label) {
  const count = text.split('\n').filter((line) => /^services:/.test(line)).length;
  return count === 1 ? [] : [`${label}: ${count} top-level services keys, expected 1`];
}

/**
 * List the stores that run as a service but ship no `compose.server.fragment.yml`.
 *
 * @param {string} root Repository root.
 * @param {Readonly<Record<string, {server: boolean}>>} traits Store traits.
 * @returns {string[]} Store names whose `source/data/<store>/` holds no such fragment.
 */
export function serverStoresMissingFragment(root, traits) {
  /**
   * Check whether a directory tree holds the fragment.
   *
   * @param {string} dir Directory to search.
   * @returns {boolean} True when found.
   */
  const has = (dir) => {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() ? has(path.join(dir, entry.name)) : entry.name === COMPOSE_SERVER_FRAGMENT,
    );
  };
  return Object.entries(traits)
    .filter(([store, trait]) => trait.server && !has(path.join(root, 'source/data', store)))
    .map(([store]) => store);
}
