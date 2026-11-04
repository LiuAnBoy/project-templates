import { Module } from '@nestjs/common';

import { HealthController } from './controllers/health.controller.js';

/**
 * The health domain: one controller, no service and no port. It reads the
 * dependency checks from the global `InfraModule`.
 */
@Module({ controllers: [HealthController] })
export class HealthModule {}
