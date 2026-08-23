import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // GET /health — server is up, no DB check
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'wazzar-backend',
      timestamp: new Date().toISOString(),
    };
  }

  // GET /health/db — server is up AND can talk to Postgres
  @Get('db')
  async checkDb() {
    const dbStatus = this.dataSource.isInitialized;
    let queryOk = false;

    if (dbStatus) {
      try {
        await this.dataSource.query('SELECT 1');
        queryOk = true;
      } catch {
        queryOk = false;
      }
    }

    return {
      status: queryOk ? 'ok' : 'error',
      database: {
        connected: dbStatus,
        queryable: queryOk,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
