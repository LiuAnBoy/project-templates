/**
 * The wire contract shared by the web and the server.
 *
 * Only schemas and the types inferred from them live here. Business
 * computation, framework code and anything that needs a database never does.
 * Add a module per feature and re-export it below.
 */
export * from './hello.js';
