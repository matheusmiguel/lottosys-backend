import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import { AffiliatesModule } from 'src/affiliates/affiliates.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule, AffiliatesModule],
	providers: [UsersService],
	controllers: [UsersController],
	exports: [UsersService]
})
export class UsersModule { }
