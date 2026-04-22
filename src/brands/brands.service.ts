import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AffiliatesService } from 'src/affiliates/affiliates.service';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { extractDomain, getPermissionsByType, realFormat, realToCents } from 'src/utils/helpers.util';
import * as bcrypt from 'bcrypt';
import { CreateBrandDto } from './dtos/create-brand.dto';
import { AuthService } from 'src/auth/auth.service';
import { default_withdrawal_configs } from './brands.config';

@Injectable()
export class BrandsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly affiliatesService: AffiliatesService,
        private readonly authService: AuthService,
    ) { }

    async getBrandCredentials(id: string, token: string, user: any) {
        await this.authService.validate2FA(user.id, token);
        
        const brand = await this.prisma.brand.findFirst({
            where: {
                id: Number(id),
                deleted_at: null,
            }
        });

        if (!brand) {
            throw new NotFoundException('Brand not found or invalid token');
        }

        // Verifica se o usuário tem permissão para acessar as credenciais da brand
        if (user.user_type !== 1 && (user.brand_id !== brand.id || user.user_type > 2)) {
            throw new BadRequestException('You do not have permission to access this brand\'s credentials');
        }

        return {
            status: 'success',
            data: {
                brand_id: brand.id,
                token: brand.token,
            }
        };
    }

    async createBrand(body: CreateBrandDto) {
        const brandUrl = body.brand_url.startsWith('http') ? body.brand_url : `https://${body.brand_url}`;
        
        // 1. Verifica se já existe brand com a mesma URL
        const existingBrand = await this.prisma.brand.findFirst({
            where: {
                url: brandUrl,
                deleted_at: null,
            }
        });

        if (existingBrand) {
            throw new BadRequestException('A brand with this URL already exists!');
        }

        const password = await bcrypt.hash(body.password, 12);
        const permissions = getPermissionsByType(2);

        try {
            // 3. Cria a brand
            const brand = await this.prisma.brand.create({
                data: {
                    user_id: 0,
                    token: randomUUID().replace(/-/g, ''),
                    public_token: randomUUID().replace(/-/g, ''),
                    url: brandUrl,
                    status: body.status,
                    name: body.brand_name,
                    document: '',
                    currency: 'brl',
                    ngr_percent: 0,
                    affiliate_auto_signup: true,
                    affiliate_signup_auto_approve: false,
                    withdrawal_configs: default_withdrawal_configs
                }
            });

            // 4. Cria o usuário admin (type = 2) vinculado à brand
            const user = await this.prisma.user.create({
                data: {
                    brand_id: brand.id,
                    validated: true,
                    confirmed: true,
                    status: 1,
                    type: 2,
                    validation_2fa: 0,
                    manager_id: 0,
                    parent_affiliate_id: 0,
                    name: body.name,
                    login: body.login,
                    email: body.email,
                    password,
                    currency: 'brl',
                    ngr_percent: 0,
                    permissions,
                }
            });

            // 5. Atualiza brand com o user_id do admin recém-criado
            await this.prisma.brand.update({
                where: { id: brand.id },
                data: { user_id: user.id }
            });

            // 6. Cria carteira principal do admin
            await this.prisma.wallet.create({
                data: {
                    brand_id: brand.id,
                    user_id: user.id,
                    name: 'Carteira Principal',
                    currency: 'brl',
                    description: '',
                    balance: 0,
                    status: 1,
                }
            });

            // Cria os tipos de link
            await this.prisma.linkType.createMany({
                data: [
                    { brand_id: brand.id, name: 'Página de Cadastro', status: 1, base_url: brand.url+'/invite/crm?redirect=/account/signup' },
                    { brand_id: brand.id, name: 'Acesso ao Site', status: 1, base_url: brand.url+'/invite/crm' },
                ]
            });

            return {
                status: 'success',
                message: 'Brand created successfully',
                data: {
                    brand: {
                        id: brand.id,
                        name: brand.name,
                        url: brand.url,
                        status: brand.status,
                    },
                    user: {
                        id: user.id,
                        name: user.name,
                        login: user.login,
                        email: user.email,
                        type: user.type,
                    }
                }
            };

        } catch (error) {
            console.error('Error creating brand:', error);
            throw new BadRequestException('An error occurred while creating the brand.');
        }
    }

    async listBrands(currency: string = 'brl') {

        const currency_data = {
            code: currency,
            prefix: this.currencyService.getCurrencyPrefix(currency),
        };

        // 1. Busca todas as brands
        const brands = await this.prisma.brand.findMany({
            where: { deleted_at: null },
            select: {
                id: true,
                status: true,
                name: true,
                url: true,
                document: true,
                currency: true,
                ngr_percent: true,
                affiliate_auto_signup: true,
                affiliate_signup_auto_approve: true,
                created_at: true,
            },
            orderBy: { created_at: 'desc' },
        });

        const brandIds = brands.map(b => b.id);

        // 2. Conta usuários por brand (uma única query)
        const userCounts = await this.prisma.user.groupBy({
            by: ['brand_id'],
            where: {
                type: { in: [3, 4, 5, 6] },
                brand_id: { in: brandIds },
                deleted_at: null,
            },
            _count: { id: true },
        });

        const userCountMap: Record<number, number> = {};
        for (const u of userCounts) {
            userCountMap[u.brand_id] = u._count.id;
        }

        // 3. Busca saldo das wallets agrupado por brand + currency
        const wallets = await this.prisma.wallet.groupBy({
            by: ['brand_id', 'currency'],
            where: {
                brand_id: { in: brandIds },
                deleted_at: null,
            },
            _sum: { balance: true },
        });

        // 4. Agrupa por moeda: { 'brl': total, 'usd': total, ... }
        //    separado por brand: { brandId: { 'brl': X, 'usd': Y } }
        const walletCurrencyMap: Record<number, Record<string, number>> = {};

        for (const w of wallets) {
            if (!walletCurrencyMap[w.brand_id]) {
                walletCurrencyMap[w.brand_id] = {};
            }

            const cur = w.currency;
            if (!walletCurrencyMap[w.brand_id][cur]) {
                walletCurrencyMap[w.brand_id][cur] = 0;
            }

            walletCurrencyMap[w.brand_id][cur] += w._sum.balance ?? 0;
        }

        // 5. Converte uma vez por moeda distinta por brand
        const walletBalanceMap: Record<number, number> = {};

        for (const [brandIdStr, currencyTotals] of Object.entries(walletCurrencyMap)) {
            const brandId = Number(brandIdStr);
            walletBalanceMap[brandId] = 0;

            for (const [cur, total] of Object.entries(currencyTotals)) {
                const converted = await this.currencyService.convertCents(total, cur, currency);
                walletBalanceMap[brandId] += converted.cents;
            }
        }

        // 6. Monta o resultado final
        const data = brands.map(brand => ({
            ...brand,
            url: extractDomain(brand.url),
            users_count: userCountMap[brand.id] ?? 0,
            wallet_balance: {
                cents: walletBalanceMap[brand.id] ?? 0,
                formatted: realFormat(walletBalanceMap[brand.id] ?? 0),
            },
        }));

        return {
            status: 'success',
            currency: currency_data,
            data,
        };
    }

    async setConfigs(body: any, user: any) {
        const brand = await this.prisma.brand.findUnique({
            where: { id: user.brand_id },
            select: {
                id: true,
                status: true,
                name: true,
                url: true,
                document: true,
                currency: true,
                ngr_percent: true,
                affiliate_auto_signup: true,
                affiliate_signup_auto_approve: true,
                withdrawal_configs: true,
            }
        });

        if (!brand) {
            throw new NotFoundException('Brand not found');
        }

        // Ajuste
        if(body.withdrawal_configs.min_amount){
            body.withdrawal_configs.min_amount = realToCents(body.withdrawal_configs.min_amount);
        }

        const updated = await this.prisma.brand.update({
            where: { id: user.brand_id },
            data: {
                currency: body.currency ?? brand.currency,
                ngr_percent: body.ngr ?? brand.ngr_percent,
                affiliate_auto_signup: body.affiliates_link ?? brand.affiliate_auto_signup,
                affiliate_signup_auto_approve: body.affiliates_approval ?? brand.affiliate_signup_auto_approve,
                withdrawal_configs: body.withdrawal_configs ?? brand.withdrawal_configs,
            }
        });

        return {
            status: 'success',
            message: 'Brand configs updated successfully',
            data: updated
        }
    }

    async getConfigs(user: any) {
        const brand = await this.prisma.brand.findUnique({
            where: { id: user.brand_id },
            select: {
                id: true,
                status: true,
                name: true,
                url: true,
                document: true,
                currency: true,
                ngr_percent: true,
                affiliate_auto_signup: true,
                affiliate_signup_auto_approve: true,
                withdrawal_configs: true,
            }
        });
        return {
            status: 'success',
            data: brand
        }
    }

    async getBrandResume(date: string, enddate: string, currency: string = 'brl', currentUser: any) {

        const start = new Date(`${date} 00:00:00`);
        const end = new Date(`${enddate} 23:59:59`);
        let currency_data = { code: currency, prefix: this.currencyService.getCurrencyPrefix(currency) };

        // DEFINE LISTA DE AFILIADOS
        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);
        }

        const data = {
            registrations: 0,
            today_registrations: 0,
            ftd_amount: 0,
            ftd_qty: 0,
            qftd_amount: 0,
            qftd_qty: 0,
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
                signup_date: {
                    gte: start,
                    lte: end
                },
                ...(currentUser.user_type > 2 && {
                    affiliate_id: { in: affiliateIds }
                })
            }
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        data.today_registrations = await this.prisma.registration.count({
            where: {
                brand_id: currentUser.brand_id,
                signup_date: {
                    gte: today
                },
                ...(currentUser.user_type > 2 && {
                    affiliate_id: { in: affiliateIds }
                })
            }
        });

        // ################ DEPOSITS ################

        const deposits = await this.prisma.deposit.groupBy({
            by: ['currency'],
            where: {
                brand_id: currentUser.brand_id,
                status: 2,
                payment_date: {
                    gte: start,
                    lte: end
                },
                ...(currentUser.user_type > 2 && {
                    affiliate_id: { in: affiliateIds }
                })
            },
            _sum: {
                amount: true
            },
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
                status: 2,
                is_first: true,
                payment_date: {
                    gte: start,
                    lte: end
                },
                ...(currentUser.user_type > 2 && {
                    affiliate_id: { in: affiliateIds }
                })
            },
            _sum: {
                amount: true
            },
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
            by: ['category', 'currency', 'type'],
            where: {
                brand_id: currentUser.brand_id,
                status: 1,
                created_at: {
                    gte: start,
                    lte: end
                },
                ...(currentUser.user_type > 2 && {
                    user_id: { in: affiliateIds }
                })
            },
            _sum: {
                amount: true
            },
            _count: true
        });

        for (const t of transactions) {

            const value = await this.currencyService.convertCents(
                t._sum.amount ?? 0,
                t.currency,
                currency
            );

            const signed = t.type === 0 ? -value.cents : value.cents;

            if (t.category === 'cpa') {
                data.cpa_amount += signed;
                data.cpa_qty += t._count;
            }

            if (t.category === 'revshare') {
                data.revshare_amount += signed;
                data.revshare_qty += t._count;
            }

            if (t.category === 'deposit') {
                data.commissions_amount += signed;
                data.commissions_qty += t._count;
            }
        }

        // ################ WITHDRAWALS ################

        const withdrawals = await this.prisma.withdrawal.groupBy({
            by: ['currency'],
            where: {
                brand_id: currentUser.brand_id,
                status: 2,
                date: {
                    gte: start,
                    lte: end
                },
                ...(currentUser.user_type > 2 && {
                    affiliate_id: { in: affiliateIds }
                })
            },
            _sum: {
                amount: true
            },
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
            enddate,
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
