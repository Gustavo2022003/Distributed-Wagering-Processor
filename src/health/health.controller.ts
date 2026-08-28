import { Controller, Get, Inject } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';

@Controller('health')
export class HealthController {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const checks: Record<string, string> = {};
    try {
      await this.em.execute('SELECT 1');
      checks.database = 'ok';
    } catch (err) {
      checks.database = 'fail';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    return { status: ok ? 'ok' : 'fail', checks };
  }
}
