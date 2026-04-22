import { Injectable } from '@nestjs/common';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import { realFormat } from 'src/utils/helpers.util';

@Injectable()
export class ReportsService {

    constructor(
        private prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly usersService: UsersService,
    ) { }

    async getResume(date: string, enddate: string, currency: string = 'brl', currentUser: any) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);

        const site_id = currentUser.site_id;
        let currency_data = { code: currency, prefix: this.currencyService.getCurrencyPrefix(currency) };

        // DEFINE LISTA DE AFILIADOS
        let userIds: number[] = [];
        if (currentUser.user_type > 2) {
            userIds = await this.usersService.getManagerTreeIds(currentUser.id, currentUser.brand_id);
        }

        const data = {
            tickets: {
                qty: 0,
                amount: 0,
            },
            tickets_by_status: {
                1: { qty: 0, amount: 0 }, // Aberto
                2: { qty: 0, amount: 0 }, // Ganhou
                3: { qty: 0, amount: 0 }, // Perdeu
                4: { qty: 0, amount: 0 }, // Cancelado
            } as Record<number, { qty: number; amount: number }>,
            users_qty: 0,
            customers_qty: 0,
            commissions: {
                qty: 0,
                amount: 0,
            },
        };

        // ################ TICKETS ################

        const tickets = await this.prisma.ticket.groupBy({
            by: ['status', 'currency'],
            where: {
                site_id,
                deleted_at: null,
                created_at: {
                    gte: start,
                    lte: end,
                },
                ...(currentUser.user_type > 2 && {
                    user_id: { in: userIds }
                })
            },
            _sum: { amount: true },
            _count: true,
        });

        for (const t of tickets) {
            const converted = await this.currencyService.convertCents(
                t._sum.amount ?? 0,
                t.currency,
                currency
            );

            data.tickets.qty += t._count;
            data.tickets.amount += converted.cents;

            if (t.status in data.tickets_by_status) {
                data.tickets_by_status[t.status].qty += t._count;
                data.tickets_by_status[t.status].amount += converted.cents;
            }
        }

        // ################ USERS ################

        data.users_qty = await this.prisma.user.count({
            where: {
                site_id,
                deleted_at: null,
                ...(currentUser.user_type > 2 && {
                    user_id: { in: userIds }
                })
            },
        });

        // ################ CUSTOMERS ################

        data.customers_qty = await this.prisma.customer.count({
            where: {
                site_id,
                deleted_at: null,
                ...(currentUser.user_type > 2 && {
                    user_id: { in: userIds }
                })
            },
        });

        // ################ COMMISSIONS ################

        const transactions = await this.prisma.transaction.groupBy({
            by: ['type', 'currency'],
            where: {
                site_id,
                deleted_at: null,
                created_at: {
                    gte: start,
                    lte: end,
                },
                ...(currentUser.user_type > 2 && {
                    user_id: { in: userIds }
                })
            },
            _sum: { amount: true },
            _count: true,
        });

        for (const t of transactions) {
            const converted = await this.currencyService.convertCents(
                t._sum.amount ?? 0,
                t.currency,
                currency
            );

            const signed = t.type === 0 ? -converted.cents : converted.cents;

            data.commissions.amount += signed;
            data.commissions.qty += t._count;
        }

        return {
            status: 'success',
            date,
            enddate,
            currency: currency_data,
            data: {
                tickets: {
                    qty: data.tickets.qty,
                    amount: realFormat(data.tickets.amount),
                },
                tickets_by_status: Object.fromEntries(
                    Object.entries(data.tickets_by_status).map(([status, val]) => [
                        status,
                        {
                            qty: val.qty,
                            amount: realFormat(val.amount),
                        },
                    ])
                ),
                users_qty: data.users_qty,
                customers_qty: data.customers_qty,
                commissions: {
                    qty: data.commissions.qty,
                    amount: realFormat(data.commissions.amount),
                },
            },
        };
    }
}
