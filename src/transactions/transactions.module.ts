import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import Redis from 'ioredis';

@Module({
	imports: [PrismaModule, AuthModule],
	providers: [
		TransactionsService,
	],
	controllers: [TransactionsController],
	exports: [],
})
export class TransactionsModule { }
