import { Injectable } from '@nestjs/common';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat } from 'src/utils/helpers.util';

@Injectable()
export class AffiliateReportsService {

    constructor(
        private prisma: PrismaService,
        private readonly currencyService: CurrencyService,
    ) { }

    async getAffiliateReport(
        affiliate_id: number,
        date: string,
        enddate: string,
        currency: string,
        currentUser: any
    ) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);
        const brand_id = currentUser.brand_id;

        /*
        =========================
        ACCESS CONTROL
        =========================
        */

        const affiliate = await this.prisma.user.findUnique({
            where: { id: affiliate_id },
            select: {
                id: true,
                login: true,
                manager_id: true,
                parent_affiliate_id: true
            }
        });

        if (!affiliate) throw new Error('Affiliate not found');

        const allowed =
            currentUser.id === affiliate.id ||
            currentUser.id === affiliate.manager_id ||
            currentUser.id === affiliate.parent_affiliate_id ||
            [1, 2].includes(currentUser.user_type);

        if (!allowed) throw new Error('Unauthorized');

        /*
        =========================
        STATS
        =========================
        */

        const stats = {
            registrations: 0,
            ftd_amount: 0,
            ftd_qty: 0,
            qftd_amount: 0,
            qftd_qty: 0,
            deposits_amount: 0,
            deposits_qty: 0,
            withdrawals_amount: 0,
            withdrawals_qty: 0,
            cpa_amount: 0,
            cpa_qty: 0,
            revshare_amount: 0,
            revshare_qty: 0,
            commissions_amount: 0,
            commissions_qty: 0
        };

        /*
        =========================
        REGISTRATIONS
        =========================
        */

        stats.registrations = await this.prisma.registration.count({
            where: {
                brand_id,
                affiliate_id,
                signup_date: { gte: start, lte: end }
            }
        });

        /*
        =========================
        DEPOSITS
        =========================
        */

        const deposits = await this.prisma.deposit.groupBy({

            by: ['currency', 'is_first', 'is_qualified'],

            where: {
                brand_id,
                affiliate_id,
                status: 2,
                date: { gte: start, lte: end }
            },

            _sum: { amount: true },
            _count: { id: true }

        });

        const addCurrency = (obj, currency, amount) => {
            if (!obj[currency]) obj[currency] = 0
            obj[currency] += amount
        }

        const depositsMap = {}
        const ftdMap = {}
        const qftdMap = {}

        for (const d of deposits) {

            const amount = d._sum.amount ?? 0

            addCurrency(depositsMap, d.currency, amount)
            stats.deposits_qty += d._count.id

            if (d.is_first) {
                addCurrency(ftdMap, d.currency, amount)
                stats.ftd_qty += d._count.id
            }

            if (d.is_first && d.is_qualified) {
                addCurrency(qftdMap, d.currency, amount)
                stats.qftd_qty += d._count.id
            }

        }

        /*
        =========================
        WITHDRAWALS
        =========================
        */

        const withdrawals = await this.prisma.withdrawal.groupBy({

            by: ['currency'],

            where: {
                brand_id,
                affiliate_id,
                status: 2,
                date: { gte: start, lte: end }
            },

            _sum: { amount: true },
            _count: { id: true }

        })

        const withdrawalsMap = {}

        for (const w of withdrawals) {

            const amount = w._sum.amount ?? 0

            addCurrency(withdrawalsMap, w.currency, amount)
            stats.withdrawals_qty += w._count.id

        }

        /*
        =========================
        TRANSACTIONS
        =========================
        */

        const transactions = await this.prisma.transaction.groupBy({

            by: ['currency', 'category', 'type', 'user_id'],

            where: {
                brand_id,
                status: 1,
                created_at: { gte: start, lte: end }
            },

            _sum: { amount: true },
            _count: { id: true }

        })

        const cpaMap = {}
        const revshareMap = {}
        const commissionsMap = {}

        for (const t of transactions) {

            const amount = t._sum.amount ?? 0
            const signed = t.type === 1 ? amount : -amount

            if (t.category === 'cpa') {
                addCurrency(cpaMap, t.currency, signed)
                stats.cpa_qty += t._count.id
            }

            if (t.category === 'revshare') {
                addCurrency(revshareMap, t.currency, signed)
                stats.revshare_qty += t._count.id
            }

            addCurrency(commissionsMap, t.currency, signed)
            stats.commissions_qty += t._count.id

        }

        /*
        =========================
        CONVERT
        =========================
        */

        const convertMap = async (map) => {

            let total = 0

            for (const [cur, val] of Object.entries(map)) {

                const r = await this.currencyService.convertCents(
                    val as number,
                    cur,
                    currency
                )

                total += r.cents

            }

            return total

        }

        /*
        =========================
        LINKS UTILIZADOS
        =========================
        */

        const links = await this.prisma.link.findMany({
            where: { brand_id, user_id: affiliate_id },
            select: { id: true, name: true }
        })

        /*
        =========================
        LAST REGISTRATIONS
        =========================
        */

        const last_registrations = await this.prisma.registration.findMany({

            where: {
                brand_id,
                affiliate_id
            },

            orderBy: {
                signup_date: 'desc'
            },

            take: 5,

            select: {
                name: true,
                login: true,
                signup_date: true,
                is_ftd: true,
                is_qftd: true
            }

        })

        return {

            status: 'success',
            affiliate: affiliate,
            stats: {
                ...stats,

                ftd_amount: realFormat(stats.ftd_amount),
                qftd_amount: realFormat(stats.qftd_amount),
                deposits_amount: realFormat(stats.deposits_amount),
                withdrawals_amount: realFormat(stats.withdrawals_amount),
                cpa_amount: realFormat(stats.cpa_amount),
                revshare_amount: realFormat(stats.revshare_amount),
                commissions_amount: realFormat(stats.commissions_amount)
            },
            links,
            last_registrations

        }

    }
}
