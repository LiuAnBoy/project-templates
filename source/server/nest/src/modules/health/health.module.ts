import { Module } from '@nestjs/common';

import { HealthController } from './controllers/health.controller.js';

/** The health domain: one liveness controller, no service and no port. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
