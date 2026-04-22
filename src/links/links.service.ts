import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AffiliatesService } from 'src/affiliates/affiliates.service';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat } from 'src/utils/helpers.util';
import { CreateLinkDto } from './dtos/create-link.dto';
import { UpdateLinkDto } from './dtos/update-link.dto';
import { randomBytes, randomUUID } from 'crypto';
import { AuthService } from 'src/auth/auth.service';

@Injectable()
export class LinksService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly affiliatesService: AffiliatesService,
        private readonly authService: AuthService
    ) { }

    async handleLink(request: any, link_id: number, user_id: number) {
        // Busca link
        const link = await this.prisma.link.findUnique({
            where: { id: Number(link_id) },
        });

        if (!link) {
            return { redirect: 'https://google.com' };
        }

        // Link inativo
        if (link.status !== 1) {
            return { redirect: 'https://google.com' };
        }

        // Remove www
        link.destination_url = link.destination_url.replace('www.', '');

        let user: any = null;

        // Lógica de usuário
        if (link.user_id === 0 || link.public) {
            const userId =
                user_id > 0
                    ? user_id
                    : request.query?.[link.user_id] || 0;

            if (userId > 0) {
                user = await this.prisma.user.findUnique({
                    where: { id: Number(userId) },
                });

                if (!user) {
                    return { redirect: link.destination_url };
                }
            } else {
                return { redirect: link.destination_url };
            }
        } else {
            user = await this.prisma.user.findUnique({
                where: { id: link.user_id },
            });

            if (!user) {
                return { redirect: link.destination_url };
            }
        }

        // Merge params
        let destinationUrl = this.mergeUrlParams(request, link.destination_url);

        // IP (Cloudflare + proxies)
        let rawIp =
            request.headers['cf-connecting-ip'] ||
            request.headers['x-forwarded-for'] ||
            request.ip ||
            request.socket?.remoteAddress;

        let userIp = Array.isArray(rawIp)
            ? rawIp[0].split(',')[0].trim()
            : rawIp?.split(',')[0].trim();

        // IP info
        const ipInfo = await this.authService.getIpInfo(userIp);

        // Salvar clique
        const click = await this.prisma.linkClick.create({
            data: {
                brand_id: user.brand_id,
                link_id: link.id,
                affiliate_id: user.id,
                deal_id: link.deal_id,
                token: this.generateToken(),
                ip_id: ipInfo?.id || 0,
                referer: request.headers['referer'] || null,
                data: {},
                registrations: 0,
            },
        });

        if (!click) {
            return { redirect: destinationUrl };
        }

        // Adiciona token
        destinationUrl = destinationUrl.includes('?')
            ? `${destinationUrl}&ztoken=${click.token}`
            : `${destinationUrl}?ztoken=${click.token}`;

        return { redirect: destinationUrl };
    }

    // ============================
    // Helpers
    // ============================

    private generateToken(): string {
        return randomBytes(16).toString('hex');
    }

    private mergeUrlParams(request: any, url: string): string {
        const params = request.query || {};
        const query = new URLSearchParams(params).toString();

        if (!query) return url;

        return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
    }

    async getLinkReport(
        id: number,
        date: string,
        enddate: string,
        currency: string,
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
        LINK (com deal e type)
        =====================================
        */

        const link = await this.prisma.link.findFirst({
            where: {
                id,
                brand_id,
                user_id: currentUser.user_type <= 2 ? undefined : currentUser.id
            },
            include: {
                user: {
                    select: {
                        login: true
                    }
                },
                deal: {
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        currency: true,
                        deposit_amount: true,
                        deposit_percent: true,
                        cpa_amount: true,
                        cpa_percent: true,
                        revshare_percent: true,
                        min_transaction_amount: true,
                    }
                },
                type: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        if (!link) {
            throw new BadRequestException('Link not found');
        }

        /*
        =====================================
        BASE OBJECT
        =====================================
        */

        const formattedDeal = link.deal ? {
            ...link.deal,
            currency: {
                code: link.deal.currency,
                prefix: this.currencyService.getCurrencyPrefix(link.deal.currency)
            },
            deposit_amount: realFormat(link.deal.deposit_amount),
            cpa_amount: realFormat(link.deal.cpa_amount),
            min_transaction_amount: realFormat(link.deal.min_transaction_amount),
        } : null;

        const data: any = {
            id: link.id,
            name: link.name,
            description: link.description,
            status: link.status,
            url: link.url,
            affiliate: link.user?.login ?? '',

            deal: formattedDeal,
            type: link.type,

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

        const addCurrency = (obj, currency, amount) => {
            if (!obj[currency]) obj[currency] = 0;
            obj[currency] += amount;
        };

        /*
        =====================================
        REGISTRATIONS
        =====================================
        */

        const registrations = await this.prisma.registration.count({
            where: {
                brand_id,
                link_id: id,
                signup_date: { gte: start, lte: end }
            }
        });

        data.registrations = registrations;

        /*
        =====================================
        DEPOSITS
        =====================================
        */

        const deposits = await this.prisma.deposit.groupBy({
            by: ['currency', 'is_first', 'is_qualified'],
            where: {
                brand_id,
                link_id: id,
                status: 2,
                date: { gte: start, lte: end }
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        for (const d of deposits) {

            const amount = d._sum.amount ?? 0;

            addCurrency(data.deposits, d.currency, amount);
            data.deposits_qty += d._count.id;

            if (d.is_first) {
                addCurrency(data.ftd, d.currency, amount);
                data.ftd_qty += d._count.id;
            }

            if (d.is_first && d.is_qualified) {
                addCurrency(data.qftd, d.currency, amount);
                data.qftd_qty += d._count.id;
            }
        }

        /*
        =====================================
        TRANSACTIONS
        =====================================
        */

        const transactions = await this.prisma.transaction.groupBy({
            by: ['currency', 'category', 'type'],
            where: {
                brand_id,
                link_id: id,
                status: 1,
                created_at: { gte: start, lte: end }
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        for (const t of transactions) {

            const amount = t._sum.amount ?? 0;
            const signed = t.type === 1 ? amount : -amount;

            if (t.category === 'cpa') {
                addCurrency(data.cpa, t.currency, signed);
                data.cpa_qty += t._count.id;
            }

            if (t.category === 'revshare') {
                addCurrency(data.revshare, t.currency, signed);
                data.revshare_qty += t._count.id;
            }

            addCurrency(data.commissions, t.currency, signed);
            data.commissions_qty += t._count.id;
        }

        /*
        =====================================
        CONVERT
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

        data.ftd_amount = realFormat(await convertMap(data.ftd));
        data.qftd_amount = realFormat(await convertMap(data.qftd));
        data.deposits_amount = realFormat(await convertMap(data.deposits));
        data.withdrawals_amount = realFormat(await convertMap(data.withdrawals));
        data.cpa_amount = realFormat(await convertMap(data.cpa));
        data.revshare_amount = realFormat(await convertMap(data.revshare));
        data.commissions_amount = realFormat(await convertMap(data.commissions));

        return {
            status: 'success',
            date,
            enddate,
            currency: currency_data,
            data
        };
    }

    // CREATE
    async createLink(dto: CreateLinkDto, currentUser: any) {
        // Pega dados do current
        const user = await this.prisma.user.findUnique({
            where: {
                id: currentUser.id
            }
        });

        if (!user) {
            throw new BadRequestException('User not found!');
        }

        // Configurações da brand
        const brand = await this.prisma.brand.findUnique({
            where: {
                id: currentUser.brand_id
            }
        });
        if (!brand) { throw new BadRequestException('Brand not found!'); }


        // Lista deals
        const deal = await this.prisma.deal.findFirst({
            where: {
                id: dto.deal_id,
                brand_id: user.brand_id,
                status: 1,
                OR: [
                    { user_id: 0 },
                    { user_id: currentUser.id },
                ]
            },
            select: {
                id: true,
                name: true,
            }
        });
        if (!deal) { throw new BadRequestException('Deal not found or not available!'); }

        // Lista tipos de link
        const type = await this.prisma.linkType.findFirst({
            where: {
                id: dto.link_type,
                brand_id: user.brand_id,
                status: 1,
            },
            select: {
                id: true,
                name: true,
                base_url: true,
            }
        });
        if (!type) { throw new BadRequestException('Link type not found or not available!'); }

        // Lista wallets
        const wallet = await this.prisma.wallet.findFirst({
            where: {
                id: dto.wallet_id,
                user_id: user.id,
                brand_id: user.brand_id,
            },
            select: {
                id: true,
                name: true,
            }
        });
        if (!wallet) { throw new BadRequestException('Wallet not found or not available!'); }

        // Definição de domínio
        let domainBase = await this.getDomain(user.brand_id);

        const link = await this.prisma.link.create({
            data: {
                brand_id: user.brand_id,
                user_id: user.id,
                deal_id: deal.id,
                wallet_id: wallet.id,
                status: 1,
                public: false,
                link_type: type.id,
                name: dto.name,
                description: dto.description,
                url: '',
                destination_url: type.base_url,
            }
        });

        // Monta URL
        const linkUrl = `https://${domainBase}/l/${link.id}/${user.id}`;
        const updated = await this.prisma.link.update({
            where: { id: link.id },
            data: {
                url: linkUrl,
            }
        });

        return {
            status: 'success',
            message: 'Link created successfully',
            data: updated
        };
    }

    // UPDATE
    async updateLink(id: number, dto: UpdateLinkDto, currentUser: any) {
        // Pega dados do current
        const user = await this.prisma.user.findUnique({
            where: {
                id: currentUser.id
            }
        });

        if (!user) {
            throw new BadRequestException('User not found!');
        }

        // Configurações da brand
        const brand = await this.prisma.brand.findUnique({
            where: {
                id: currentUser.brand_id
            }
        });
        if (!brand) { throw new BadRequestException('Brand not found!'); }


        // Lista deals
        const deal = await this.prisma.deal.findFirst({
            where: {
                id: dto.deal_id,
                brand_id: user.brand_id,
                status: 1,
                OR: [
                    { user_id: 0 },
                    { user_id: currentUser.id },
                ]
            },
            select: {
                id: true,
                name: true,
            }
        });
        if (!deal) { throw new BadRequestException('Deal not found or not available!'); }

        // Lista tipos de link
        const type = await this.prisma.linkType.findFirst({
            where: {
                id: dto.link_type,
                brand_id: user.brand_id,
                status: 1,
            },
            select: {
                id: true,
                name: true,
                base_url: true,
            }
        });
        if (!type) { throw new BadRequestException('Link type not found or not available!'); }

        // Lista wallets
        const wallet = await this.prisma.wallet.findFirst({
            where: {
                id: dto.wallet_id,
                user_id: user.id,
                brand_id: user.brand_id,
            },
            select: {
                id: true,
                name: true,
            }
        });
        if (!wallet) { throw new BadRequestException('Wallet not found or not available!'); }

        // Definição de domínio
        let domainBase = await this.getDomain(user.brand_id);

        const link = await this.prisma.link.update({
            where: { id },
            data: {
                deal_id: deal.id,
                wallet_id: wallet.id,
                link_type: type.id,
                name: dto.name,
                description: dto.description,
                destination_url: type.base_url,
            }
        });

        return {
            status: 'success',
            message: 'Link updated successfully',
            data: link
        };
    }

    async getLinkConfigs(currentUser: any) {
        const brand_id = currentUser.brand_id;

        // Pega dados do usuário
        const user = await this.prisma.user.findUnique({
            where: { id: currentUser.id }
        });

        if (!user) {
            throw new BadRequestException('User not found!');
        }

        // Se não estiver aprovado
        if (!user.confirmed) {
            throw new UnauthorizedException('Your account is not approved yet. Please wait for the approval to access link configurations.');
        }

        // Lista deals
        const deals = await this.prisma.deal.findMany({
            where: {
                brand_id,
                status: 1,
                OR: [
                    { user_id: 0 },
                    { user_id: currentUser.id },
                ]
            },
            select: {
                id: true,
                name: true,
            },
            orderBy: { id: 'desc' },
        });

        // Lista tipos de link
        const types = await this.prisma.linkType.findMany({
            where: { brand_id },
            select: {
                id: true,
                name: true,
            },
            orderBy: { id: 'desc' },
        });

        // Lista wallets
        const wallets = await this.prisma.wallet.findMany({
            where: { brand_id, user_id: currentUser.id },
            select: {
                id: true,
                name: true,
            },
            orderBy: { id: 'desc' },
        });

        return {
            status: 'success',
            deals,
            types,
            wallets
        };
    }

    async getLinkById(id: number, currentUser: any) {
        const brand_id = currentUser.brand_id;

        let where: any = { brand_id, id };
        where.user_id = currentUser.id;

        const link = await this.prisma.link.findFirst({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        login: true,
                        email: true,
                    }
                },
                deal: {
                    select: {
                        id: true,
                        name: true,
                    }
                },
                type: {
                    select: {
                        id: true,
                        name: true,
                    }
                },
            }
        });

        return {
            status: 'success',
            data: link
        };
    }

    async getLinks(currentUser: any) {
        const brand_id = currentUser.brand_id;

        let where: any = { brand_id };
        where.user_id = currentUser.id;

        const links = await this.prisma.link.findMany({
            where,
            orderBy: { id: 'desc' },
            include: {
                user: {
                    select: {
                        id: true,
                        login: true,
                        email: true,
                    }
                },
                deal: {
                    select: {
                        id: true,
                        name: true,
                    }
                },
                type: {
                    select: {
                        id: true,
                        name: true,
                    }
                },
            }
        });

        return {
            status: 'success',
            data: links
        };
    }

    async getLinksTopRanking(
        date: string,
        enddate: string,
        sort: string,
        currency: string,
        limit: number = 5,
        currentUser: any,
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
        DEFINE LINKS (ACCESS CONTROL)
        =====================================
        */

        let links: any[] = [];

        if (currentUser.user_type <= 2) {

            // admin → todos links da brand
            links = await this.prisma.link.findMany({
                where: { brand_id },
                select: {
                    id: true,
                    name: true,
                    user: {
                        select: {
                            login: true
                        }
                    }
                }
            });

        } else {
            // Lista árvore de afiliados
            let affiliateIds: number[] = [];
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);

            // afiliado → só os links dele
            links = await this.prisma.link.findMany({
                where: {
                    brand_id,
                    user_id: { in: affiliateIds }
                },
                select: {
                    id: true,
                    name: true,
                    user: {
                        select: {
                            login: true
                        }
                    }
                }
            });

        }

        const map: Record<number, any> = {};

        for (const l of links) {

            map[l.id] = {
                id: l.id,
                name: l.name,
                affiliate: l.user?.login ?? '',

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
            by: ['link_id', 'currency', 'is_first', 'is_qualified'],
            where: {
                brand_id,
                status: 2,
                date: { gte: start, lte: end },
                link_id: { in: Object.keys(map).map(Number) }
            },
            _sum: { amount: true },
            _count: { id: true }
        });

        for (const d of deposits) {

            const link = map[d.link_id!];
            if (!link) continue;

            const amount = d._sum.amount ?? 0;

            addCurrency(link.deposits, d.currency, amount);

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
        =====================================
        COMMISSIONS
        =====================================
        */

        const transactions = await this.prisma.transaction.groupBy({
            by: ['link_id', 'currency', 'category', 'type'],
            where: {
                brand_id,
                status: 1,
                created_at: { gte: start, lte: end },
                link_id: { in: Object.keys(map).map(Number) }
            },
            _sum: { amount: true }
        });

        for (const t of transactions) {

            const link = map[t.link_id];
            if (!link) continue;

            const amount = t._sum.amount ?? 0;
            const signed = t.type === 1 ? amount : -amount;

            addCurrency(link.commissions, t.currency, signed);
        }

        /*
        =====================================
        CONVERT
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

        for (const link of Object.values(map)) {

            const depositCents = await convertMap(link.deposits);
            const commissionCents = await convertMap(link.commissions);
            const ftdCents = await convertMap(link.ftd);
            const qftdCents = await convertMap(link.qftd);

            // remove 0 depósitos
            if (depositCents <= 0) continue;

            const roi = depositCents > 0
                ? (commissionCents / depositCents) * 100
                : 0;

            result.push({
                id: link.id,
                name: link.name,
                affiliate: link.affiliate,

                ftd_qty: link.ftd_qty,
                qftd_qty: link.qftd_qty,

                deposit_amount: realFormat(depositCents),
                commission_amount: realFormat(commissionCents),
                ftd_amount: realFormat(ftdCents),
                qftd_amount: realFormat(qftdCents),

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

        switch (sort) {

            case 'roi':
                result.sort((a, b) => b.roi - a.roi);
                break;

            case 'deposits':
                result.sort((a, b) => b._deposit_cents - a._deposit_cents);
                break;

            case 'ftd':
                result.sort((a, b) => b._ftd_cents - a._ftd_cents);
                break;

            default:
                result.sort((a, b) => b._commission_cents - a._commission_cents);
                break;
        }

        /*
        =====================================
        LIMIT
        =====================================
        */

        const limited = result.slice(0, limit);
        const finalData = limited.map(({ _deposit_cents, _commission_cents, _ftd_cents, ...rest }) => rest);
        return {
            status: 'success',
            date,
            enddate,
            currency: currency_data,
            data: finalData
        };
    }

    async getReferralLink(currentUser: any) {
        const brand = await this.prisma.brand.findUnique({
            where: { id: currentUser.brand_id },
            select: {
                public_token: true,
            }
        });

        if (!brand) {
            throw new Error('Brand not found');
        }

        // Seleciona dados do usuário
        const user = await this.prisma.user.findUnique({
            where: { id: currentUser.id },
        });

        if (!user) {
            throw new Error('User not found');
        }

        // Se não tiver token cadastrado
        let token: string;
        if (!user.user_token) {
            token = randomUUID();
            const updatedUser = await this.prisma.user.update({
                where: { id: currentUser.id },
                data: { user_token: token }
            });
        } else {
            token = user.user_token;
        }

        return {
            referral_link: `${process.env.FRONTEND_URL}/signup/${token}`,
        };

    }

    async getDomain(brand_id: number) {
        // Busca domínios disponíveis
        const domains = await this.prisma.domain.findMany({
            where: {
                status: 1,
                OR: [
                    { brand_id: brand_id },
                    { brand_id: 0 }
                ]
            },
            orderBy: {
                is_public: 'asc'
            }
        });

        let domainBase = '';
        let domainFound = false;

        for (const d of domains) {
            if (domainFound) continue;

            // ignora domínio global não público
            if (d.brand_id === 0 && d.is_public === 0) {
                continue;
            }

            domainFound = true;
            domainBase = d.domain;
        }

        if (!domainFound) {
            throw new BadRequestException('No available domain found!');
        }

        return domainBase;
    }

    buildLinkUrl(domainBase: string, linkId: number, userId: number): string {
        return `https://${domainBase}/l/${linkId}/${userId}`;
    }
}
