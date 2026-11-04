# Extending: ports and factories

New capabilities are added by implementing a port and adding one line at the wiring place. The framework and the existing code are not edited. `hello` is the model to copy: its service depends on a `Greeter` port, `createStaticGreeter()` implements it, and one wiring place connects them.

## The rule

- A port is a TypeScript `interface` in `<domain>/<name>.ts`. Code outside the wiring place depends on the port only, never on an implementation.
- Each implementation is exported through a `createXxx(deps)` factory. It takes everything it needs as arguments and reads no global config, no `process.env` and no singleton.
- One wiring place picks and connects the implementations: `main.ts`, in the `modules` array passed to `buildServer`. It is the only place that knows which implementation is in use.
- Plain functions and route files stay plain. The factory pattern applies to ports and to objects that cannot be built without configuration.

## Add a capability

1. Define the port: a TypeScript `interface` in `<domain>/<name>.ts`.
2. Implement it in `<domain>/<impl>.ts` as `createXxx(deps)`, taking its dependencies as arguments.
3. Wire it with one line at the wiring place, and nothing else changes.
4. Test the consumer with a fake: passing a fake straight to the factory: `buildServer({ modules: [createHelloModule({ greeter: fake })] })`, with no patching or mocking library. One test shows that swapping the fake changes the answer with no other code touched.
5. If the capability needs configuration, add the variable to the env schema and `.env.example` (fake value), then read it at the wiring place only.
6. Record it in the docs listed in `docs-to-update.md`.

## Choose an adapter by configuration

Read the config at the wiring place and pass the chosen implementation down. A factory never reads config itself.

```ts
const mailer =
  config.MAIL_DRIVER === 'smtp'
    ? createSmtpMailer({ host: config.SMTP_HOST })
    : createLogMailer();
const app = await buildServer({
  logLevel: config.LOG_LEVEL,
  modules: [createOrdersModule({ mailer })],
});
```

An unknown driver value should fail at boot, in the env schema, not at the first request.

## Several implementations: a registry

When implementations coexist (several news sources, several notification channels), keep them in `createRegistry<T>()` from `src/common/registry.ts`. It has `register(key, value)`, `get(key)` and `all()`. Registering a duplicate key throws, and getting an unknown key throws, so a mistake shows at boot.

```ts
const sources = createRegistry<Source>();
sources.register('rss', createRssSource());
sources.register('api', createApiSource({ baseUrl: config.SOURCE_URL }));
const app = await buildServer({ modules: [createFeedModule({ sources })] });
```

Adding an implementation is then one more `register` line.

## Do not

- Do not import an implementation from a service, controller or route; import the port.
- Do not read `process.env` or a config singleton inside a factory.
- Do not patch modules in tests; pass or override the fake at the wiring place.
- Do not add a switch on a driver name inside a service. Choose at the wiring place.
