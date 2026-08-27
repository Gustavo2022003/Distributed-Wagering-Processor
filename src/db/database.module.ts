// src/db/database.module.ts

import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { mikroOrmConfig } from './mikro-orm.config';

@Module({
  imports: [
    MikroOrmModule.forRoot({
      ...mikroOrmConfig,
    }),
  ],
  exports: [MikroOrmModule],
})
export class DatabaseModule {}
