import { BadRequestException, Injectable } from '@nestjs/common';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat } from 'src/utils/helpers.util';

@Injectable()
export class AffiliatesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService
    ) { }

    async getAffiliateLinks(id: number, currentUser: any) {
        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            affiliateIds = await this.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);

            if (!affiliateIds.includes(id)) {
                throw new BadRequestException('You don\'t have permission to view this data!');
            }
        }

        const links = await this.prisma.link.findMany({
            where: {
                brand_id: currentUser.brand_id,
                user_id: id,
            },
            select: {
                id: true,
                name: true,
                url: true,
            }
        });

        return {
            status: 'success',
            data: links
        };
    }

    async getAffiliateStatement(
        date: string,
        enddate: string,
        currency: string,
        limit: number = 50,
        page: number = 1,
        affiliate_id: number = 0,
        currentUser: any
    ) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);
        const brand_id = currentUser.brand_id;

        const currency_data = {
            code: currency,
            prefix: this.currencyService.getCurrencyPrefix(currency)
        };

        /*
        =====================================
        ACCESS CONTROL
        =====================================
        */
        let userIds: number[] = [];

        if (currentUser.user_type <= 2) {

            const users = await this.prisma.user.findMany({
                where: {
                    brand_id,
                    type: 4
                },
                select: { id: true }
            });

            userIds = users.map(u => u.id);

        } else {
            userIds = await this.getAffiliateTreeIds(currentUser.id, brand_id);
        }

        // Se um affiliate_id específico for fornecido, verificar se ele está na lista de IDs acessíveis
        if (affiliate_id) {
            if (!userIds.includes(affiliate_id)) {
                throw new BadRequestException('You don\'t have permission to view this data!');
            }
            userIds = [affiliate_id];
        }


        /*
        =====================================
        PAGINATION
        =====================================
        */
        const skip = (page - 1) * limit;

        /*
        =====================================
        TRANSACTIONS LIST
        =====================================
        */
        const [transactions, total] = await Promise.all([

            this.prisma.transaction.findMany({
                where: {
                    brand_id,
                    created_at: { gte: start, lte: end },
                    user_id: { in: userIds }
                },
                orderBy: {
                    created_at: 'desc'
                },
                skip,
                take: limit,
                select: {
                    id: true,
                    created_at: true,
                    amount: true,
                    currency: true,
                    type: true,
                    paid: true,
                    category: true,
                    status: true,
                    title: true,
                    wallet_id: true,
                    settlement_id: true,
                    wallet: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    link: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }),

            this.prisma.transaction.count({
                where: {
                    brand_id,
                    status: 1,
                    created_at: { gte: start, lte: end },
                    user_id: { in: userIds }
                }
            })

        ]);

        /*
        =====================================
        SUMMARY (GROUPED)
        =====================================
        */
        const grouped = await this.prisma.transaction.groupBy({
            by: ['currency', 'type'],
            where: {
                brand_id,
                status: 1,
                created_at: { gte: start, lte: end },
                user_id: { in: userIds }
            },
            _sum: {
                amount: true
            }
        });

        let totalIn = 0;
        let totalOut = 0;

        for (const t of grouped) {

            const converted = await this.currencyService.convertCents(
                t._sum.amount ?? 0,
                t.currency,
                currency
            );

            if (t.type === 1) {
                totalIn += converted.cents;
            } else {
                totalOut += converted.cents;
            }
        }

        const totalResult = totalIn - totalOut;

        /*
        =====================================
        FORMAT LIST
        =====================================
        */
        const list = transactions.map(t => {

            const signed = t.type === 0 ? -t.amount : t.amount;

            return {
                id: t.id,
                date: t.created_at,
                category: t.category,
                wallet: t.wallet
                    ? { id: t.wallet.id, name: t.wallet.name }
                    : null,

                link: t.link
                    ? { id: t.link.id, name: t.link.name }
                    : null,
                status: t.status,
                title: t.title,
                currency: t.currency,
                amount: realFormat(signed),
                amount_cents: signed,
                is_paid: t.paid,
                // is_paid: !!t.settlement_id
            };
        });

        /*
        =====================================
        RESPONSE
        =====================================
        */
        return {
            status: 'success',
            date,
            enddate,
            currency: currency_data,

            summary: {
                total_in: {
                    cents: totalIn,
                    formatted: realFormat(totalIn)
                },
                total_out: {
                    cents: totalOut,
                    formatted: realFormat(totalOut)
                },
                total_result: {
                    cents: totalResult,
                    formatted: realFormat(totalResult)
                }
            },

            pagination: {
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit)
            },

            data: list
        };
    }

    async getAffiliatesTopRanking(
        date: string,
        enddate: string,
        sort: string,
        currency: string,
        limit: number = 5,
        currentUser: any
    ) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);
        const brand_id = currentUser.brand_id;

        const currency_data = {
            code: currency,
            prefix: this.currencyService.getCurrencyPrefix(currency)
        };

        /*
        =====================================
        DEFINE AFFILIATES (ACCESS CONTROL)
        =====================================
        */

        let affiliates: any[] = [];

        if (currentUser.user_type <= 2) {
            // admin -> todos afiliados da brand
            affiliates = await this.prisma.user.findMany({
                where: {
                    brand_id,
                    type: 4
                },
                select: {
                    id: true,
                    login: true,
                    email: true
                }
            });
        } else {
            // Lista árvore de afiliados
            let affiliateIds: number[] = [];
            affiliateIds = await this.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);

            affiliates = await this.prisma.user.findMany({
                where: {
                    brand_id,
                    type: 4,
                    id: { in: affiliateIds }
                },
                select: {
                    id: true,
                    login: true,
                    email: true
                }
            });
        }

        const map: Record<number, any> = {};

        for (const a of affiliates) {
            map[a.id] = {
                id: a.id,
                login: a.login,
                email: a.email,

                ftd_qty: 0,
                qftd_qty: 0,

                deposits: {},
                commissions: {},
                ftd: {},
                qftd: {}
            };
        }

        const addCurrency = (obj, currency, amount) => {
            if (!obj[currency]) obj[currency] = 0;
            obj[currency] += amount;
        };

        /*
        =====================================
        DEPOSITS
        =====================================
        */

        const deposits = await this.prisma.deposit.groupBy({
            by: ['affiliate_id', 'currency', 'is_first', 'is_qualified'],
            where: {
                brand_id,
                status: 2,
                date: { gte: start, lte: end },
                affiliate_id: { in: Object.keys(map).map(Number) }
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        for (const d of deposits) {

            const aff = map[d.affiliate_id];
            if (!aff) continue;

            const amount = d._sum.amount ?? 0;

            addCurrency(aff.deposits, d.currency, amount);

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
        =====================================
        COMMISSIONS (TRANSACTIONS)
        =====================================
        */

        const transactions = await this.prisma.transaction.groupBy({
            by: ['user_id', 'currency', 'category', 'type'],
            where: {
                brand_id,
                status: 1,
                created_at: { gte: start, lte: end },
                user_id: { in: Object.keys(map).map(Number) }
            },
            _sum: { amount: true }
        });

        for (const t of transactions) {

            const aff = map[t.user_id];
            if (!aff) continue;

            const amount = t._sum.amount ?? 0;
            const signed = t.type === 1 ? amount : -amount;

            addCurrency(aff.commissions, t.currency, signed);
        }

        /*
        =====================================
        CONVERT + BUILD RESPONSE
        =====================================
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

        const result: any[] = [];

        for (const aff of Object.values(map)) {

            const depositCents = await convertMap(aff.deposits);
            const commissionCents = await convertMap(aff.commissions);
            const ftdCents = await convertMap(aff.ftd);
            const qftdCents = await convertMap(aff.qftd);

            const roi = depositCents > 0
                ? (commissionCents / depositCents) * 100
                : 0;

            result.push({
                id: aff.id,
                login: aff.login,
                email: aff.email,

                ftd_qty: aff.ftd_qty,
                qftd_qty: aff.qftd_qty,

                deposit_amount: realFormat(depositCents),
                commission_amount: realFormat(commissionCents),
                ftd_amount: realFormat(ftdCents),
                qftd_amount: realFormat(qftdCents),

                // usados só internamente
                _ftd_cents: ftdCents,
                _deposit_cents: depositCents,
                _commission_cents: commissionCents,

                roi: Number(roi.toFixed(2))
            });
        }

        /*
        =====================================
        SORT
        =====================================
        */

        const filtered = result.filter(item => item._deposit_cents > 0);

        switch (sort) {
            case 'roi':
                filtered.sort((a, b) => b.roi - a.roi);
                break;

            case 'deposits':
                filtered.sort((a, b) => b._deposit_cents - a._deposit_cents);
                break;

            case 'ftd':
                filtered.sort((a, b) => b._ftd_cents - a._ftd_cents);
                break;

            default:
                // fallback: comissão
                filtered.sort((a, b) => b._commission_cents - a._commission_cents);
                break;
        }

        const limited = filtered.slice(0, limit);
        const finalData = limited.map(({ _deposit_cents, _commission_cents, _ftd_cents, ...rest }) => rest);
        return {
            status: 'success',
            date,
            enddate,
            currency: currency_data,
            data: finalData
        };
    }

    async getAffiliateTreeIds(rootId: number, brand_id: number): Promise<number[]> {

        const users = await this.prisma.user.findMany({
            where: {
                brand_id,
            },
            select: {
                id: true,
                parent_affiliate_id: true
            }
        });

        const tree: Record<number, number[]> = {};

        for (const u of users) {

            if (!u.parent_affiliate_id) continue;

            if (!tree[u.parent_affiliate_id]) {
                tree[u.parent_affiliate_id] = [];
            }

            tree[u.parent_affiliate_id].push(u.id);
        }

        const result: number[] = [];
        const queue: number[] = [rootId];

        while (queue.length) {

            const current = queue.shift()!;
            result.push(current);

            const children = tree[current] || [];

            for (const child of children) {
                queue.push(child);
            }
        }

        return result;
    }
}
