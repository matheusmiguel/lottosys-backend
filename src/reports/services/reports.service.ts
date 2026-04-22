import { Injectable } from '@nestjs/common';
import { AffiliatesService } from 'src/affiliates/affiliates.service';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat } from 'src/utils/helpers.util';

@Injectable()
export class ReportsService {

    constructor(
        private prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly affiliatesService: AffiliatesService,
    ) { }

    async getDateResume(date: string, currency: string = 'brl', currentUser: any) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${date} 23:59:59`);

        let currency_data = {
            code: currency,
            prefix: this.currencyService.getCurrencyPrefix(currency)
        };

        // ################ PERMISSION FILTER ################

        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);
        }

        const data = {
            registrations: 0,
            ftd_amount: 0,
            ftd_qty: 0,
            deposits_amount: 0,
            deposits_qty: 0,
            cpa_amount: 0,
            cpa_qty: 0,
            revshare_amount: 0,
            revshare_qty: 0,
            commissions_amount: 0,
            commissions_qty: 0,
            withdrawals_amount: 0,
            withdrawals_qty: 0,
        };

        // ################ REGISTRATIONS ################

        data.registrations = await this.prisma.registration.count({
            where: {
                brand_id: currentUser.brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                signup_date: {
                    gte: start,
                    lte: end
                }
            }
        });

        // ################ DEPOSITS ################

        const deposits = await this.prisma.deposit.groupBy({
            by: ['currency'],
            where: {
                brand_id: currentUser.brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                status: 2,
                payment_date: {
                    gte: start,
                    lte: end
                }
            },
            _sum: { amount: true },
            _count: true
        });

        data.deposits_qty = deposits.reduce((a, b) => a + b._count, 0);

        for (const d of deposits) {
            const converted = await this.currencyService.convertCents(
                d._sum.amount ?? 0,
                d.currency,
                currency
            );
            data.deposits_amount += converted.cents;
        }

        // ################ FTD ################

        const ftd = await this.prisma.deposit.groupBy({
            by: ['currency'],
            where: {
                brand_id: currentUser.brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                status: 2,
                is_first: true,
                payment_date: {
                    gte: start,
                    lte: end
                }
            },
            _sum: { amount: true },
            _count: true
        });

        data.ftd_qty = ftd.reduce((a, b) => a + b._count, 0);

        for (const d of ftd) {
            const converted = await this.currencyService.convertCents(
                d._sum.amount ?? 0,
                d.currency,
                currency
            );
            data.ftd_amount += converted.cents;
        }

        // ################ TRANSACTIONS ################

        const transactions = await this.prisma.transaction.groupBy({
            by: ['category', 'currency'],
            where: {
                brand_id: currentUser.brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        user_id: {
                            in: affiliateIds
                        }
                    }
                ),
                status: 1,
                created_at: {
                    gte: start,
                    lte: end
                }
            },
            _sum: { amount: true },
            _count: true
        });

        for (const t of transactions) {

            const value = await this.currencyService.convertCents(
                t._sum.amount ?? 0,
                t.currency,
                currency
            );

            if (t.category === 'cpa') {
                data.cpa_amount += value.cents;
                data.cpa_qty += t._count;
            }

            if (t.category === 'revshare') {
                data.revshare_amount += value.cents;
                data.revshare_qty += t._count;
            }

            if (t.category === 'deposit') {
                data.commissions_amount += value.cents;
                data.commissions_qty += t._count;
            }
        }

        // ################ WITHDRAWALS ################

        const withdrawals = await this.prisma.withdrawal.groupBy({
            by: ['currency'],
            where: {
                brand_id: currentUser.brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                status: 2,
                date: {
                    gte: start,
                    lte: end
                }
            },
            _sum: { amount: true },
            _count: true
        });

        data.withdrawals_qty = withdrawals.reduce((a, b) => a + b._count, 0);

        for (const w of withdrawals) {
            const converted = await this.currencyService.convertCents(
                w._sum.amount ?? 0,
                w.currency,
                currency
            );
            data.withdrawals_amount += converted.cents;
        }

        // ################ COMMISSIONS ################

        data.commissions_amount += data.cpa_amount + data.revshare_amount;
        data.commissions_qty += data.cpa_qty + data.revshare_qty;

        return {
            status: 'success',
            date,
            currency: currency_data,
            data: {
                ...data,
                ftd_amount: realFormat(data.ftd_amount),
                deposits_amount: realFormat(data.deposits_amount),
                cpa_amount: realFormat(data.cpa_amount),
                revshare_amount: realFormat(data.revshare_amount),
                commissions_amount: realFormat(data.commissions_amount),
                withdrawals_amount: realFormat(data.withdrawals_amount),
            }
        };
    }
}
