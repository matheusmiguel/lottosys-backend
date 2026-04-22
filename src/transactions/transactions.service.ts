import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WithdrawalItem } from './transactions.types';
import { formatDateTime, realFormat } from 'src/utils/helpers.util';

@Injectable()
export class TransactionsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService
    ) { }

    async listWithdrawals(
        date: string,
        enddate: string,
        sort: string,
        limit: number = 50,
        page: number = 1,
        currentUser: any
    ) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);

        const skip = (page - 1) * limit;

        const where = {
            brand_id: currentUser.brand_id,
            category: 'withdrawal',
            created_at: {
                gte: start,
                lte: end
            },
        };

        const total = await this.prisma.transaction.count({ where });
        const withdrawals = await this.prisma.transaction.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        login: true,
                        name: true,
                        email: true,
                        img: true
                    }
                },
                wallet: {
                    select: {
                        id: true,
                        name: true,
                        balance: true,
                        currency: true
                    }
                }
            },
            orderBy: {
                created_at: sort === 'asc' ? 'asc' : 'desc'
            },
            take: limit,
            skip
        });

        // ################ FORMAT ################
        const formatted: WithdrawalItem[] = withdrawals.map((w) => ({
            id: w.id,
            status: w.status,
            amount: realFormat(w.amount),
            amount_cents: w.amount,
            category: w.category,
            currency: {
                code: w.currency,
                prefix: this.currencyService.getCurrencyPrefix(w.currency)
            },
            user: w.user
                ? {
                    id: w.user.id,
                    login: w.user.login,
                    name: w.user.name,
                    email: w.user.email,
                    img: w.user.img
                }
                : null,
            wallet: w.wallet
                ? {
                    id: w.wallet.id,
                    name: w.wallet.name,
                    balance: realFormat(w.wallet.balance),
                    currency: w.wallet.currency,
                }
                : null,
            created_at: formatDateTime(w.created_at),
            updated_at: formatDateTime(w.updated_at),
        }));

        return {
            status: 'success',
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit),
                has_next: page * limit < total,
                has_prev: page > 1
            },
            data: formatted
        };
    }

    async updateTransactionStatus(
        id: number,
        status: number,
        currentUser: any
    ) {

        const transaction = await this.prisma.transaction.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!transaction) {
            throw new NotFoundException('Transaction not found');
        }

        // Filtra status
        if (status  < 1 || status > 4 || status === transaction.status) {
            throw new BadRequestException('Invalid status value');
        }

        // Evita alterar transações sem permissão
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You cannot update transactions!');
        }

        const updated = await this.prisma.transaction.update({
            where: { id },
            data: {
                status: status
            }
        });

        // Devolve valor, caso seja saque negado
        if (transaction.category === 'withdrawal' && transaction.amount > 0 && status === 4) {
            // Idempotência: só devolve se ainda não tiver sido pago
            const wallet = await this.prisma.wallet.findUnique({
                where: {
                    id: transaction.wallet_id
                }
            });

            if(!wallet) {
                throw new NotFoundException('Associated wallet not found');
            }

            await this.prisma.wallet.update({
                where: {
                    id: transaction.wallet_id
                },
                data: {
                    balance: (transaction.amount + wallet.balance)
                }
            });
        }

        return {
            status: 'success',
            message: 'Transaction status updated successfully',
            data: updated
        };
    }
}
