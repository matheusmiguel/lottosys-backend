import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';
import { MigrationProgressService } from './migration-progress.service';
import { MigrationWorker } from './migration.worker';
import { OldPrismaService } from './old-prisma.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { Redis } from 'ioredis';
import { MigrationLookupController } from './migration-lookup.controller';
import { MigrationLookupService } from './migration-lookup.service';
import { AuthModule } from 'src/auth/auth.module';
import { MigrationUrlSyncService } from './migration-url-sync.service';
import { LinksModule } from 'src/links/links.module';

@Module({
	imports: [
		AuthModule,
		PrismaModule,
		LinksModule,
		BullModule.registerQueue({
			name: 'migration',
		}),
	],
	controllers: [MigrationController, MigrationLookupController],
	providers: [
		{
			provide: 'REDIS',
			useFactory: () => {
				return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
			},
		},
		MigrationService,
		MigrationProgressService,
		MigrationWorker,
		OldPrismaService,
		MigrationLookupService,
		MigrationUrlSyncService
	],
})
export class MigrationModule { }