import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';
import { CurrencyModule } from 'src/currency/currency.module';
import { UsersModule } from 'src/users/users.module';

@Module({
	imports: [PrismaModule, AuthModule, CurrencyModule, UsersModule],
	controllers: [PublicController],
	providers: [PublicService]
})
export class PublicModule { }
