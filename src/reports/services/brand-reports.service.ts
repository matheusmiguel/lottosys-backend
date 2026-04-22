import { Injectable } from '@nestjs/common';
import { AffiliatesService } from 'src/affiliates/affiliates.service';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat } from 'src/utils/helpers.util';

@Injectable()
export class BrandReportsService {

    constructor(
        private prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly affiliatesService: AffiliatesService,
    ) { }

    async getDailyReport(
        date: string,
        enddate: string,
        currency: string,
        currentUser: any
    ) {
        const currency_data = {
            code: currency,
            prefix: this.currencyService.getCurrencyPrefix(currency)
        };

        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);
        }

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);
        const brand_id = currentUser.brand_id;
        const days: Record<string, any> = {};
        const getDay = (d: Date) => d.toISOString().slice(0, 10);

        const ensureDay = (day: string) => {
            if (!days[day]) {
                days[day] = {
                    date: day,
                    registrations: 0,
                    ftd: {},
                    qftd: {},
                    deposits: {},
                    withdrawals: {},
                    cpa: {},
                    revshare: {},
                    commissions: {},
                    ftd_qty: 0,
                    qftd_qty: 0,
                    deposits_qty: 0,
                    withdrawals_qty: 0,
                    cpa_qty: 0,
                    revshare_qty: 0,
                    commissions_qty: 0
                };
            }
        };

        const addCurrency = (obj, currency, amount) => {
            if (!obj[currency]) {
                obj[currency] = 0;
            }
            obj[currency] += amount;
        };

        /*
        =====================================
        REGISTRATIONS
        =====================================
        */
        const registrations = await this.prisma.registration.groupBy({
            by: ['signup_date'],
            where: {
                brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                signup_date: { gte: start, lte: end }
            },
            _count: { id: true }
        });

        for (const r of registrations) {
            const day = getDay(r.signup_date!);
            ensureDay(day);
            days[day].registrations += r._count.id;
        }

        /*
        =====================================
        DEPOSITS
        =====================================
        */
        const deposits = await this.prisma.deposit.groupBy({
            by: ['date', 'currency', 'is_first', 'is_qualified'],
            where: {
                brand_id,
                status: 2,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                date: { gte: start, lte: end }
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        for (const d of deposits) {
            if (!d.date) continue;
            const day = getDay(d.date);
            ensureDay(day);
            const amount = d._sum.amount ?? 0;
            addCurrency(days[day].deposits, d.currency, amount);
            days[day].deposits_qty += d._count.id;

            if (d.is_first) {
                addCurrency(days[day].ftd, d.currency, amount);
                days[day].ftd_qty += d._count.id;
            }

            if (d.is_first && d.is_qualified) {
                addCurrency(days[day].qftd, d.currency, amount);
                days[day].qftd_qty += d._count.id;
            }
        }

        /*
        =====================================
        WITHDRAWALS
        =====================================
        */
        const withdrawals = await this.prisma.withdrawal.groupBy({
            by: ['date', 'currency'],
            where: {
                brand_id,
                status: 2,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                date: { gte: start, lte: end }
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        for (const w of withdrawals) {
            if (!w.date) continue;
            const day = getDay(w.date);
            ensureDay(day);
            const amount = w._sum.amount ?? 0;
            addCurrency(days[day].withdrawals, w.currency, amount);
            days[day].withdrawals_qty += w._count.id;
        }

        /*
        =====================================
        TRANSACTIONS
        =====================================
        */
        const transactions = await this.prisma.transaction.groupBy({
            by: ['created_at', 'currency', 'category', 'type'],
            where: {
                brand_id,
                status: 1,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        user_id: {
                            in: affiliateIds
                        }
                    }
                ),
                created_at: { gte: start, lte: end }
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        for (const t of transactions) {
            if (!t.created_at) continue;
            const day = getDay(t.created_at);
            ensureDay(day);
            const amount = t._sum.amount ?? 0;
            const signed = t.type === 1 ? amount : -amount;

            if (t.category === 'cpa') {
                addCurrency(days[day].cpa, t.currency, signed);
                days[day].cpa_qty += t._count.id;
            }

            if (t.category === 'revshare') {
                addCurrency(days[day].revshare, t.currency, signed);
                days[day].revshare_qty += t._count.id;
            }

            addCurrency(days[day].commissions, t.currency, signed);
            days[day].commissions_qty += t._count.id;
        }

        /*
        =====================================
        CONVERT CURRENCY
        =====================================
        */
        const convertMap = async (map) => {
            let total = 0;
            for (const [cur, val] of Object.entries(map)) {
                const result = await this.currencyService.convertCents(
                    val as number,
                    cur,
                    currency
                );
                total += result.cents;
            }

            return total;
        };

        for (const day of Object.values(days)) {
            day.ftd_amount = realFormat(await convertMap(day.ftd));
            day.qftd_amount = realFormat(await convertMap(day.qftd));
            day.deposits_amount = realFormat(await convertMap(day.deposits));
            day.withdrawals_amount = realFormat(await convertMap(day.withdrawals));
            day.cpa_amount = realFormat(await convertMap(day.cpa));
            day.revshare_amount = realFormat(await convertMap(day.revshare));
            day.commissions_amount = realFormat(await convertMap(day.commissions));

            day.ftd = this.formatCurrencyMap(day.ftd);
            day.qftd = this.formatCurrencyMap(day.qftd);
            day.deposits = this.formatCurrencyMap(day.deposits);
            day.withdrawals = this.formatCurrencyMap(day.withdrawals);
            day.cpa = this.formatCurrencyMap(day.cpa);
            day.revshare = this.formatCurrencyMap(day.revshare);
            day.commissions = this.formatCurrencyMap(day.commissions);
        }

        /*
        =====================================
        RESPONSE
        =====================================
        */
        return {
            status: 'success',
            currency: currency_data,
            date,
            enddate,
            data: Object.values(days)
                .sort((a, b) => b.date.localeCompare(a.date))
        };
    }

    async getLinksReport(date: string, enddate: string, currency: string, currentUser: any) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);
        const brand_id = currentUser.brand_id;
        const currency_data = {
            code: currency,
            prefix: this.currencyService.getCurrencyPrefix(currency)
        };

        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);
        }

        const links = await this.prisma.link.findMany({
            where: { 
                brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        user_id: {
                            in: affiliateIds
                        }
                    }
                ),
            },
            select: {
                id: true,
                name: true,
                user: { select: { login: true } }
            }
        });

        const linksMap: Record<number, any> = {};

        for (const l of links) {

            linksMap[l.id] = {
                link_id: l.id,
                link_name: l.name,
                affiliate: l.user?.login ?? '',

                registrations: 0,

                ftd: {},
                qftd: {},
                deposits: {},
                withdrawals: {},
                cpa: {},
                revshare: {},
                commissions: {},

                ftd_qty: 0,
                qftd_qty: 0,
                deposits_qty: 0,
                withdrawals_qty: 0,
                cpa_qty: 0,
                revshare_qty: 0,
                commissions_qty: 0
            };

        }

        const addCurrency = (obj, currency, amount) => {
            if (!obj[currency]) obj[currency] = 0;
            obj[currency] += amount;
        };

        /*
        REGISTRATIONS
        */

        const registrations = await this.prisma.registration.groupBy({
            by: ['link_id'],
            where: {
                brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                signup_date: { gte: start, lte: end },
                link_id: { not: 0 }
            },
            _count: { id: true }
        });

        for (const r of registrations) {
            if (!r.link_id) continue;
            if (!linksMap[r.link_id]) continue;
            linksMap[r.link_id].registrations = r._count.id;
        }

        /*
        DEPOSITS
        */

        const deposits = await this.prisma.deposit.groupBy({
            by: ['link_id', 'currency', 'is_first', 'is_qualified'],
            where: {
                brand_id,
                status: 2,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        affiliate_id: {
                            in: affiliateIds
                        }
                    }
                ),
                date: { gte: start, lte: end },
                link_id: { not: 0 }
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        for (const d of deposits) {

            if(!d.link_id) continue;
            const link = linksMap[d.link_id];
            if (!link) continue;

            const amount = d._sum.amount ?? 0;

            addCurrency(link.deposits, d.currency, amount);
            link.deposits_qty += d._count.id;

            if (d.is_first) {

                addCurrency(link.ftd, d.currency, amount);
                link.ftd_qty += d._count.id;

            }

            if (d.is_first && d.is_qualified) {

                addCurrency(link.qftd, d.currency, amount);
                link.qftd_qty += d._count.id;

            }

        }

        /*
        TRANSACTIONS
        */

        const transactions = await this.prisma.transaction.groupBy({

            by: ['link_id', 'currency', 'category', 'type'],

            where: {
                brand_id,
                status: 1,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        user_id: {
                            in: affiliateIds
                        }
                    }
                ),
                created_at: { gte: start, lte: end },
                link_id: { not: 0 }
            },

            _sum: { amount: true },
            _count: { id: true }

        });

        for (const t of transactions) {

            if(!t.link_id) continue;
            const link = linksMap[t.link_id];
            if (!link) continue;

            const amount = t._sum.amount ?? 0;
            const signed = t.type === 1 ? amount : -amount;

            if (t.category === 'cpa') {

                addCurrency(link.cpa, t.currency, signed);
                link.cpa_qty += t._count.id;

            }

            if (t.category === 'revshare') {

                addCurrency(link.revshare, t.currency, signed);
                link.revshare_qty += t._count.id;

            }

            addCurrency(link.commissions, t.currency, signed);
            link.commissions_qty += t._count.id;

        }

        /*
        CONVERT
        */

        const convertMap = async (map) => {

            let total = 0;

            for (const [cur, val] of Object.entries(map)) {

                const result = await this.currencyService.convertCents(
                    val as number,
                    cur,
                    currency
                );

                total += result.cents;

            }

            return total;

        };

        for (const link of Object.values(linksMap)) {

            link.ftd_amount = realFormat(await convertMap(link.ftd));
            link.qftd_amount = realFormat(await convertMap(link.qftd));
            link.deposits_amount = realFormat(await convertMap(link.deposits));
            link.withdrawals_amount = realFormat(await convertMap(link.withdrawals));
            link.cpa_amount = realFormat(await convertMap(link.cpa));
            link.revshare_amount = realFormat(await convertMap(link.revshare));
            link.commissions_amount = realFormat(await convertMap(link.commissions));

        }

        return {

            status: 'success',
            date,
            enddate,
            currency: currency_data,
            data: Object.values(linksMap)
                .sort((a, b) => b.commissions_qty - a.commissions_qty)

        };

    }

    async getAffiliatesReport(
        date: string,
        enddate: string,
        currency: string,
        currentUser: any
    ) {
        const currency_data = {
            code: currency,
            prefix: this.currencyService.getCurrencyPrefix(currency)
        };
        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);
        const brand_id = currentUser.brand_id;

        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);
        }

        const affiliates = await this.prisma.user.findMany({
            where: {
                brand_id,
                ...(currentUser.user_type <= 2
                    ? {}
                    : {
                        id: {
                            in: affiliateIds
                        }
                    }
                ),
                type: 4
            },
            select: {
                id: true,
                login: true,
                img: true,
            }
        });

        const map: Record<number, any> = {};

        for (const a of affiliates) {

            map[a.id] = {

                affiliate_id: a.id,
                affiliate: a.login,
                affiliate_img: a.img,

                registrations: 0,

                ftd: {},
                qftd: {},
                deposits: {},
                withdrawals: {},
                cpa: {},
                revshare: {},
                commissions: {},

                ftd_qty: 0,
                qftd_qty: 0,
                deposits_qty: 0,
                withdrawals_qty: 0,
                cpa_qty: 0,
                revshare_qty: 0,
                commissions_qty: 0

            };

        }

        const addCurrency = (obj, currency, amount) => {

            if (!obj[currency]) obj[currency] = 0;
            obj[currency] += amount;

        };

        /*
        REGISTRATIONS
        */

        const registrations = await this.prisma.registration.groupBy({

            by: ['affiliate_id'],

            where: {
                brand_id,
                signup_date: { gte: start, lte: end },
                affiliate_id: { not: 0 }
            },

            _count: { id: true }

        });

        for (const r of registrations) {
            if(!r.affiliate_id) continue;
            if (!map[r.affiliate_id]) continue;

            map[r.affiliate_id].registrations = r._count.id;

        }

        /*
        DEPOSITS
        */

        const deposits = await this.prisma.deposit.groupBy({

            by: ['affiliate_id', 'currency', 'is_first', 'is_qualified'],

            where: {
                brand_id,
                status: 2,
                date: { gte: start, lte: end },
                affiliate_id: { not: 0 }
            },

            _sum: { amount: true },
            _count: { id: true }

        });

        for (const d of deposits) {
            if(!d.affiliate_id) continue;
            const aff = map[d.affiliate_id];
            if (!aff) continue;

            const amount = d._sum.amount ?? 0;

            addCurrency(aff.deposits, d.currency, amount);
            aff.deposits_qty += d._count.id;

            if (d.is_first) {

                addCurrency(aff.ftd, d.currency, amount);
                aff.ftd_qty += d._count.id;

            }

            if (d.is_first && d.is_qualified) {

                addCurrency(aff.qftd, d.currency, amount);
                aff.qftd_qty += d._count.id;

            }

        }

        /*
        WITHDRAWALS
        */

        const withdrawals = await this.prisma.withdrawal.groupBy({

            by: ['affiliate_id', 'currency'],

            where: {
                brand_id,
                status: 2,
                date: { gte: start, lte: end },
                affiliate_id: { not: 0 }
            },

            _sum: { amount: true },
            _count: { id: true }

        });

        for (const w of withdrawals) {

            const aff = map[w.affiliate_id];
            if (!aff) continue;

            const amount = w._sum.amount ?? 0;

            addCurrency(aff.withdrawals, w.currency, amount);
            aff.withdrawals_qty += w._count.id;

        }

        /*
        TRANSACTIONS
        */

        const transactions = await this.prisma.transaction.groupBy({

            by: ['user_id', 'currency', 'category', 'type'],

            where: {
                brand_id,
                status: 1,
                created_at: { gte: start, lte: end },
                user_id: { not: 0 }
            },

            _sum: { amount: true },
            _count: { id: true }

        });

        for (const t of transactions) {

            const aff = map[t.user_id];
            if (!aff) continue;

            const amount = t._sum.amount ?? 0;
            const signed = t.type === 1 ? amount : -amount;

            if (t.category === 'cpa') {

                addCurrency(aff.cpa, t.currency, signed);
                aff.cpa_qty += t._count.id;

            }

            if (t.category === 'revshare') {

                addCurrency(aff.revshare, t.currency, signed);
                aff.revshare_qty += t._count.id;

            }

            addCurrency(aff.commissions, t.currency, signed);
            aff.commissions_qty += t._count.id;

        }

        /*
        CONVERT
        */

        const convertMap = async (map) => {

            let total = 0;

            for (const [cur, val] of Object.entries(map)) {

                const r = await this.currencyService.convertCents(
                    val as number,
                    cur,
                    currency
                );

                total += r.cents;

            }

            return total;

        };

        for (const aff of Object.values(map)) {

            aff.ftd_amount = realFormat(await convertMap(aff.ftd));
            aff.qftd_amount = realFormat(await convertMap(aff.qftd));
            aff.deposits_amount = realFormat(await convertMap(aff.deposits));
            aff.withdrawals_amount = realFormat(await convertMap(aff.withdrawals));
            aff.cpa_amount = realFormat(await convertMap(aff.cpa));
            aff.revshare_amount = realFormat(await convertMap(aff.revshare));
            aff.commissions_amount = realFormat(await convertMap(aff.commissions));

            aff.ftd = this.formatCurrencyMap(aff.ftd);
            aff.qftd = this.formatCurrencyMap(aff.qftd);
            aff.deposits = this.formatCurrencyMap(aff.deposits);
            aff.withdrawals = this.formatCurrencyMap(aff.withdrawals);
            aff.cpa = this.formatCurrencyMap(aff.cpa);
            aff.revshare = this.formatCurrencyMap(aff.revshare);
            aff.commissions = this.formatCurrencyMap(aff.commissions);

        }

        return {

            status: 'success',
            date,
            enddate,
            currency: currency_data,
            data: Object.values(map)
                .sort((a, b) => b.commissions_qty - a.commissions_qty)

        };

    }

    formatCurrencyMap(map: Record<string, number>) {
        const formatted: Record<string, string> = {};
        for (const [currency, cents] of Object.entries(map)) {
            formatted[currency] = realFormat(cents);
        }

        return formatted;
    }
}
