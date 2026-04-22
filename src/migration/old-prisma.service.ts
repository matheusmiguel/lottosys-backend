import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '.prisma/old-client';

@Injectable()
export class OldPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
        const base = process.env.OLD_DATABASE_URL!;
        const url = base.includes('?')
            ? base + '&zeroDateTimeBehavior=convertToNull'
            : base + '?zeroDateTimeBehavior=convertToNull';

        super({
            datasources: {
                db: { url },
            },
        });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}