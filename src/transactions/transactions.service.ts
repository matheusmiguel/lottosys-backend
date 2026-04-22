import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { WithdrawalItem } from './transactions.types';
import { formatDateTime, realFormat } from 'src/utils/helpers.util';

@Injectable()
export class TransactionsService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

}
