import { Module } from '@nestjs/common';

import { HelloController } from './controllers/hello.controller.js';
import { GREETER } from './ports/greeter.port.js';
import { createStaticGreeter } from './providers/static-greeter.js';
import { HelloService } from './services/hello.service.js';

/**
 * The hello domain: one controller, one service, and the wiring place of its
 * port. `useFactory` picks the `Greeter` implementation; code outside this
 * module depends on the port only. To add or swap an implementation, write
 * its `createXxx` factory and change the one `GREETER` line below.
 */
@Module({
  controllers: [HelloController],
  providers: [
    { provide: GREETER, useFactory: createStaticGreeter },
    HelloService,
  ],
})
export class HelloModule {}
