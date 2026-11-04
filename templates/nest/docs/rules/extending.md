# Extending: ports and factories

New capabilities are added by implementing a port and adding one line at the wiring place. The framework and the existing code are not edited. `hello` is the model to copy: its service depends on a `Greeter` port, `createStaticGreeter()` implements it, and one wiring place connects them.

## The rule

- A port is a TypeScript `interface` plus a DI token (`export const GREETER = Symbol('GREETER')`), in `modules/<domain>/ports/<name>.port.ts`. Code outside the wiring place depends on the port only, never on an implementation.
- Each implementation is exported through a `createXxx(deps)` factory. It takes everything it needs as arguments and reads no global config, no `process.env` and no singleton.
- One wiring place picks and connects the implementations: the module's `providers` array, as `{ provide: GREETER, useFactory: createXxx, inject: [...] }`, in `<domain>.module.ts`. It is the only place that knows which implementation is in use.
- Ordinary controllers and services stay ordinary Nest providers with constructor injection. The factory pattern applies to ports and to objects that cannot be built without configuration.

## Add a capability

1. Define the port: a TypeScript `interface` plus a DI token (`export const GREETER = Symbol('GREETER')`), in `modules/<domain>/ports/<name>.port.ts`.
2. Implement it in `modules/<domain>/providers/<impl>.ts` as `createXxx(deps)`, taking its dependencies as arguments.
3. Wire it with one line at the wiring place, and nothing else changes.
4. Test the consumer with a fake: `Test.createTestingModule(...).overrideProvider(TOKEN).useValue(fake)`, which `createTestApp(controllers, override)` in `src/test/create-app.ts` exposes. One test shows that swapping the fake changes the answer with no other code touched.
5. If the capability needs configuration, add the variable to the env schema and `.env.example` (fake value), then read it at the wiring place only.
6. Record it in the docs listed in `docs-to-update.md`.

## Choose an adapter by configuration

Read the config at the wiring place and pass the chosen implementation down. A factory never reads config itself.

```ts
{
  provide: MAILER,
  useFactory: (config: ConfigService<Env, true>): Mailer =>
    config.get('MAIL_DRIVER', { infer: true }) === 'smtp'
      ? createSmtpMailer({ host: config.get('SMTP_HOST', { infer: true }) })
      : createLogMailer(),
  inject: [ConfigService],
}
```

An unknown driver value should fail at boot, in the env schema, not at the first request.

## Several implementations: a registry

When implementations coexist (several news sources, several notification channels), keep them in `createRegistry<T>()` from `src/common/registry.ts`. It has `register(key, value)`, `get(key)` and `all()`. Registering a duplicate key throws, and getting an unknown key throws, so a mistake shows at boot.

```ts
{
  provide: SOURCES,
  useFactory: (): Registry<Source> => {
    const registry = createRegistry<Source>();
    registry.register('rss', createRssSource());
    registry.register('api', createApiSource({ baseUrl }));
    return registry;
  },
}
```

Adding an implementation is then one more `register` line.

## Do not

- Do not import an implementation from a service, controller or route; import the port.
- Do not read `process.env` or a config singleton inside a factory.
- Do not patch modules in tests; pass or override the fake at the wiring place.
- Do not add a switch on a driver name inside a service. Choose at the wiring place.
