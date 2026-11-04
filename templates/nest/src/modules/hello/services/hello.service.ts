import { Inject, Injectable } from '@nestjs/common';

import type { HelloDto } from '../dto/hello.dto.js';
import { GREETER, type Greeter } from '../ports/greeter.port.js';

/**
 * Holds the business flow of the hello domain. A real service owns the
 * transaction scope and calls other modules through their services; this one
 * depends only on the `Greeter` port.
 */
@Injectable()
export class HelloService {
  constructor(@Inject(GREETER) private readonly greeter: Greeter) {}

  /**
   * Builds the greeting.
   *
   * @returns The data of the hello route.
   */
  getHello(): HelloDto {
    return { message: this.greeter.greet() };
  }
}
