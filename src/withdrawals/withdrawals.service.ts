import { Injectable } from '@nestjs/common';
import { AffiliatesService } from 'src/affiliates/affiliates.service';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat } from 'src/utils/helpers.util';

const PAGE_SIZE = 50;

@Injectable()
export class WithdrawalsService {

    constructor(
        private prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly affiliatesService: AffiliatesService,
    ) { }

    private hasPermission(user: any, permission: string): boolean {
        return user?.permissions?.includes(permission);
    }

    async listWithdrawals(
        user_id: number | undefined,
        date: string,
        enddate: string,
        currency: string,
        context: string,
        page: number = 1,
        currentUser: any,
    ) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);
        const brand_id = currentUser.brand_id;
        const skip = (page - 1) * PAGE_SIZE;

        // LIMITAÇÃO DE VISUALIZAÇÃO
        const fieldPermissionsMap = {
            email:    'ld.v_email',
            name:     'ld.v_name',
            login:    'ld.v_login',
            document: 'ld.v_doc',
            phone:    'ld.v_phone',
        };

        let permissions = {
            email:    true,
            login:    true,
            name:     true,
            document: true,
            phone:    true,
        };

        if (currentUser.user_type > 2) {
            Object.keys(fieldPermissionsMap).forEach((field) => {
                const perm = fieldPermissionsMap[field];
                if (!this.hasPermission(currentUser, perm)) {
                    permissions[field] = false;
                }
            });
        }

        /*
        =========================
        WHERE
        =========================
        */

        const where: any = {
            brand_id,
            status: 2,
            date: { gte: start, lte: end },
        };

        if (user_id && context === 'lead') {
            where.user_id = user_id;
        } else if (user_id && context === 'affiliate') {
            where.affiliate_id = user_id;
        }

        // Limite de visualização
        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);
            where.affiliate_id = { in: affiliateIds };
        }

        /*
        =========================
        LIST (paginada)
        =========================
        */

        const [rawWithdrawals, total] = await this.prisma.$transaction([

            this.prisma.withdrawal.findMany({
                where,
                orderBy: { date: 'desc' },
                skip,
                take: PAGE_SIZE,
                select: {
                    id: true,
                    user_id: true,
                    status: true,
                    date: true,
                    currency: true,
                    amount: true,
                    commission: true,
                    is_first: true,
                    external_id: true,
                    lead: {
                        select: {
                            id: true,
                            login: true,
                            email: true,
                            img: true,
                        },
                    },
                    affiliate: {
                        select: {
                            id: true,
                            login: true,
                            img: true,
                        },
                    },
                    link: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            }),

            this.prisma.withdrawal.count({ where }),

        ]);

        const withdrawals = rawWithdrawals.map((d) => ({
            ...d,
            amount: realFormat(d.amount),
            lead: d.lead ? {
                id:    d.lead.id,
                img:   d.lead.img,
                login: permissions.login ? d.lead.login : 'User ' + d.lead.id,
                email: permissions.email ? d.lead.email : null,
            } : null,
        }));

        let user: any = null;
        if (context === 'affiliate') {
            user = user_id && rawWithdrawals.length > 0
                ? rawWithdrawals[0].affiliate
                : null;
        } else if (context === 'lead') {
            const raw = user_id && rawWithdrawals.length > 0
                ? rawWithdrawals[0].lead
                : null;

            user = raw ? {
                id:    raw.id,
                img:   raw.img,
                login: permissions.login ? raw.login : null,
                email: permissions.email ? raw.email : null,
            } : null;
        }

        /*
        =========================
        TOTAIS POR MOEDA
        =========================
        */

        const grouped = await this.prisma.withdrawal.groupBy({
            by: ['currency'],
            where,
            _sum: { amount: true },
            _count: { id: true },
        });

        const total_by_currency = grouped.map((g) => ({
            currency: g.currency,
            amount: realFormat(g._sum.amount ?? 0),
            qty: g._count.id,
        }));

        /*
        =========================
        TOTAL CONVERTIDO
        =========================
        */

        let converted_total_cents = 0;

        for (const g of grouped) {
            const r = await this.currencyService.convertCents(
                g._sum.amount ?? 0,
                g.currency,
                currency,
            );
            converted_total_cents += r.cents;
        }

        /*
        =========================
        RESPONSE
        =========================
        */

        return {
            status: 'success',
            data: withdrawals,
            user,
            context,
            total_by_currency,
            total: {
                currency,
                amount: realFormat(converted_total_cents),
            },
            pagination: {
                page,
                page_size: PAGE_SIZE,
                total,
                total_pages: Math.ceil(total / PAGE_SIZE),
            },
        };

    }
}