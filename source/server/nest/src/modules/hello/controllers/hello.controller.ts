import { Controller, Get } from '@nestjs/common';

import type { HelloDto } from '../dto/hello.dto.js';
import { HelloService } from '../services/hello.service.js';

/**
 * Handles HTTP only: call the service and return plain data. The response
 * interceptor wraps it in the envelope. The route is public because the
 * template ships no authentication.
 */
@Controller('hello')
export class HelloController {
  constructor(private readonly hello: HelloService) {}

  /**
   * `GET /api/v1/hello`.
   *
   * @returns The greeting.
   */
  @Get()
  get(): HelloDto {
    return this.hello.getHello();
  }
}
