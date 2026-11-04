import { success } from '../common/http/envelope.js';
import type { ServerModule } from '../common/module.js';
import { helloResponseSchema } from './schemas.js';
import { createHelloService, type HelloServiceDeps } from './service.js';

/**
 * Creates the hello module. A route stays thin: parse, call the service, wrap
 * the answer. The route is public because the template ships no authentication.
 *
 * Adding a domain follows this shape: a `createXxxModule(deps)` factory that
 * takes its ports as arguments, mounted by one line in `main.ts`.
 *
 * @param deps - The ports the module uses.
 * @returns The module, ready to mount.
 */
export function createHelloModule(deps: HelloServiceDeps): ServerModule {
  const service = createHelloService(deps);
  return async (app) => {
    app.get(
      '/hello',
      { schema: { response: { 200: helloResponseSchema } } },
      async () => success(service.getHello()),
    );
  };
}
