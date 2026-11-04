# Extending: ports and factories

This is the required way to develop new backend capabilities. A capability is added by implementing a port and adding one line at the wiring place. The framework and the existing code are not edited. `hello` is the model to copy: its service depends on a `Greeter` port, `create_static_greeter()` implements it, and one wiring place connects them.

## The rule

- A port is a `typing.Protocol`, in `<module>/<name>.py`. Code outside the wiring place depends on the port only, never on an implementation.
- Each implementation is exported through a `create_xxx(deps)` factory. It takes everything it needs as arguments and reads no global settings, no `os.environ` and no module-level singleton.
- One wiring place picks and connects the implementations: `main.py` (which modules are mounted) and each module's `dependencies.py` (which implementation backs each port). They are the only files that know which implementation is in use.
- Ordinary routers and services stay ordinary: a service takes its ports in `__init__`, and a `create_xxx_service(...)` factory builds it. The pattern applies to ports and to objects that cannot be built without configuration.

## Add a capability

1. Define the port as a `Protocol` in `<module>/<name>.py`.
2. Implement it in `<module>/<impl>.py` as `create_xxx(deps)`, taking its dependencies as arguments.
3. Wire it with one line in the module's `dependencies.py`: the provider function returns the factory's result. Nothing else changes.
4. Test the consumer with a fake: replace the provider with `app.dependency_overrides[get_greeter] = lambda: fake`. One test shows that swapping the fake changes the answer with no other code touched.
5. If the capability needs configuration, add the setting to `core/config.py` and `.env.example` (fake value), then read it at the wiring place only.
6. Record it in the docs listed in `docs-to-update.md`.

## Choose an adapter by configuration

Read the settings at the wiring place and pass the chosen implementation down. A factory never reads settings itself.

```python
def get_mailer() -> Mailer:
    """Pick the mailer by configuration."""
    if settings.mail_driver == "smtp":
        return create_smtp_mailer(host=settings.smtp_host)
    return create_log_mailer()
```

An unknown driver value should fail at boot, in the settings class (use a `Literal`), not at the first request.

## Several implementations: a registry

When implementations coexist (several news sources, several notification channels), keep them in a registry from `src/core/registry.py`. It has `register(key, value)`, `get(key)` and `all()`. Registering a duplicate key raises, and getting an unknown key raises, so a mistake shows at boot.

```python
sources: Registry[Source] = create_registry()
sources.register("rss", create_rss_source())
sources.register("api", create_api_source(base_url=settings.source_url))
```

Adding an implementation is then one more `register` line.

## Do not

- Do not import an implementation from a service or router; import the port.
- Do not read settings or `os.environ` inside a factory.
- Do not patch modules in tests; override the provider at the wiring place.
- Do not add a switch on a driver name inside a service. Choose at the wiring place.
