import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat, realToCents } from 'src/utils/helpers.util';
import { CreateWalletDto } from './dtos/create-wallet.dto';
import { UpdateWalletDto } from './dtos/update-wallet.dto';
import { AddWalletTransactionDto } from './dtos/add-wallet-transaction.dto';
import { AuthService } from 'src/auth/auth.service';
import { MakeWithdrawalDto } from './dtos/make-withdrawal.dto';

@Injectable()
export class WalletsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly authService: AuthService
    ) { }

    async getWalletById(id: number, currentUser: any) {

        const wallet = await this.prisma.wallet.findFirst({
            select: {
                id: true,
                user_id: true,
                status: true,
                name: true,
                description: true,
                currency: true,
                balance: true,
                created_at: true,
                updated_at: true,
            },
            where: {
                id,
                brand_id: currentUser.brand_id,
            }
        });

        if (!wallet) {
            throw new NotFoundException('Wallet not found');
        }

        // Evita listar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2 && wallet.user_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this wallet!');
        }

        return {
            status: 'success',
            data: wallet
        };
    }

    // MAKE WITHDRAWAL
    async makeWithdrawal(id: number, dto: MakeWithdrawalDto, currentUser: any) {
        const user = await this.prisma.user.findUnique({
            where: { id: currentUser.id },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        const wallet = await this.prisma.wallet.findFirst({
            where: {
                id,
                user_id: currentUser.id
            }
        });

        if (!wallet) {
            throw new NotFoundException('Wallet not found');
        }

        const brand = await this.prisma.brand.findUnique({
            where: { id: currentUser.brand_id },
            select: {
                withdrawal_configs: true,
                currency: true
            }
        });

        if (!brand) {
            throw new NotFoundException('Brand not found');
        }

        let configs = brand.withdrawal_configs as {
            min_days_interval: number;
            min_amount: number;
            days: Record<string, boolean>;
        };

        // Pesquisa configuração por usuário
        if (user.withdrawal_configs) {
            configs = user.withdrawal_configs as {
                min_days_interval: number;
                min_amount: number;
                days: Record<string, boolean>;
            };
        }

        // Verifica se o dia atual é permitido
        const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const todayName = DAY_NAMES[new Date().getDay()];

        if (!configs.days[todayName]) {
            // throw new BadRequestException(`Withdrawals are not allowed on ${todayName}s`);
            throw new BadRequestException(`Withdrawals are not allowed today`);
        }

        const amount = realToCents(dto.amount);

        // Converte o valor do saque para a moeda da brand pra comparar com min_amount
        if (configs.min_amount > 0) {
            const minInWalletCurrency = await this.currencyService.convertCents(
                configs.min_amount,
                brand.currency,
                wallet.currency
            );

            if (amount < minInWalletCurrency.cents) {
                const differentCurrency = wallet.currency.toLowerCase() !== brand.currency.toLowerCase();
                const suffix = differentCurrency
                    ? ` (${minInWalletCurrency.prefix} ${realFormat(minInWalletCurrency.cents)})`
                    : '';

                throw new BadRequestException(
                    `Minimum withdrawal amount is ${brand.currency.toUpperCase()} ${realFormat(configs.min_amount)}${suffix}`
                );
            }
        }

        // Confere se o usuário tem saldo suficiente
        if (amount > wallet.balance) {
            throw new BadRequestException(
                'Insufficient balance for this withdrawal. Your current balance is ' +
                wallet.currency.toUpperCase() + ' ' + realFormat(wallet.balance)
            );
        }

        // Cria transação
        await this.prisma.transaction.create({
            data: {
                brand_id: currentUser.brand_id,
                user_id: wallet.user_id,
                link_id: 0,
                wallet_id: wallet.id,
                status: 0,
                category: 'withdrawal',
                type: 0,
                paid: true,
                action_type: 0,
                action_id: 0,
                title: 'Pedido de Saque',
                description: '',
                amount,
                currency: wallet.currency,
                sub_id: 0,
                parent_commission: 0,
                ngr: 0,
                is_manual: true
            },
        });

        const updated = await this.prisma.wallet.update({
            where: { id },
            data: {
                balance: {
                    decrement: amount
                }
            }
        });

        return {
            status: 'success',
            data: {
                id: updated.id,
                user_id: updated.user_id,
                status: updated.status,
                name: updated.name,
                description: updated.description,
                currency: updated.currency,
                balance: updated.balance,
                created_at: updated.created_at,
                updated_at: updated.updated_at,
            }
        };
    }

    // ADD TRANSACTION
    async addWalletTransaction(id: number, dto: AddWalletTransactionDto, currentUser: any) {

        await this.authService.validate2FA(currentUser.id, dto.token);

        const wallet = await this.prisma.wallet.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!wallet) {
            throw new NotFoundException('Wallet not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You don\'t have permission to update this wallet!');
        }

        let amount = realToCents(dto.amount);
        if (dto.type === 0) {
            amount = wallet.balance - amount;
        } else if (dto.type === 1) {
            amount += wallet.balance;
        } else {
            throw new BadRequestException('Invalid transaction type');
        }

        // Cria transação
        await this.prisma.transaction.create({
            data: {
                brand_id: currentUser.brand_id,
                user_id: wallet.user_id,
                link_id: 0,
                wallet_id: wallet.id,
                status: 1,
                category: 'transaction',
                type: dto.type,
                paid: true,
                action_type: 0,
                action_id: 0,
                title: dto.title ?? 'Transação manual',
                description: '',
                amount: realToCents(dto.amount),
                currency: wallet.currency,
                sub_id: 0,
                parent_commission: 0,
                ngr: 0,
                is_manual: true
            },
        });

        const updated = await this.prisma.wallet.update({
            where: {
                id
            },
            data: {
                balance: amount
            }
        });

        return {
            status: 'success',
            data: {
                id: updated.id,
                user_id: updated.user_id,
                status: updated.status,
                name: updated.name,
                description: updated.description,
                currency: updated.currency,
                balance: updated.balance,
                created_at: updated.created_at,
                updated_at: updated.updated_at,
            }
        };
    }

    // UPDATE
    async updateWallet(id: number, dto: UpdateWalletDto, currentUser: any) {

        const wallet = await this.prisma.wallet.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!wallet) {
            throw new NotFoundException('Wallet not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (wallet.user_id !== currentUser.id && currentUser.user_type > 2) {
            throw new BadRequestException('You don\'t have permission to update this wallet!');
        }

        const updated = await this.prisma.wallet.update({
            where: {
                id
            },
            data: {
                name: dto.name,
                description: dto.description,
            }
        });

        return {
            status: 'success',
            data: {
                id: updated.id,
                user_id: updated.user_id,
                status: updated.status,
                name: updated.name,
                description: updated.description,
                currency: updated.currency,
                balance: updated.balance,
                created_at: updated.created_at,
                updated_at: updated.updated_at,
            }
        };
    }

    async addWallet(currentUser: any, dto: CreateWalletDto) {

        const wallet = await this.prisma.wallet.create({
            data: {
                brand_id: currentUser.brand_id,
                user_id: currentUser.id,
                status: 1,
                name: dto.name,
                balance: 0,
                currency: dto.currency,
                description: dto.description
            }
        });

        return {
            status: 'success',
            data: wallet
        }
    }

    async listWalletSettlementsByUser(currentUser: any, user_id: number) {
        // Somente para admins
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You don\'t have permission to perform this action!');
        }

        const wallets = await this.prisma.walletSettlement.findMany({
            where: {
                brand_id: currentUser.brand_id,
                user_id: user_id
            },
            select: {
                id: true,
                wallet_id: true,
                wallet: {
                    select: {
                        name: true,
                        currency: true
                    }
                },
                amount: true,
                currency: true,
                transactions_qty: true,
                created_at: true,
                updated_at: true,
            },
            orderBy: { created_at: 'desc' }
        });

        const formattedWallets = wallets.map(wallet => ({
            ...wallet,
            amount: realFormat(wallet.amount)
        }));

        return {
            status: 'success',
            data: formattedWallets
        };
    }

    async listWalletsByUser(currentUser: any, user_id: number) {
        // Somente para admins
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You don\'t have permission to perform this action!');
        }

        const wallets = await this.prisma.wallet.findMany({
            where: {
                brand_id: currentUser.brand_id,
                user_id: user_id
            },
            select: {
                id: true,
                status: true,
                name: true,
                description: true,
                currency: true,
                balance: true,
                created_at: true,
                updated_at: true,
            }
        });

        const formattedWallets = wallets.map(wallet => ({
            ...wallet,
            balance: realFormat(wallet.balance)
        }));

        return {
            status: 'success',
            data: formattedWallets
        };
    }

    async listWallets(currentUser: any) {
        const user = await this.prisma.user.findUnique({
            where: { id: currentUser.id },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        const wallets = await this.prisma.wallet.findMany({
            where: {
                brand_id: currentUser.brand_id,
                user_id: currentUser.id
            },
            select: {
                id: true,
                status: true,
                name: true,
                description: true,
                currency: true,
                balance: true,
                created_at: true,
                updated_at: true,
            }
        });

        const formattedWallets = wallets.map(wallet => ({
            ...wallet,
            balance: realFormat(wallet.balance)
        }));

        // Obtém configurações de saque
        const brand = await this.prisma.brand.findUnique({
            where: { id: currentUser.brand_id },
            select: {
                currency: true,
                withdrawal_configs: true
            }
        });

        let withdrawal_configs: any = {};
        if (brand?.withdrawal_configs) {
            withdrawal_configs = brand?.withdrawal_configs ?? null;
            withdrawal_configs.currency = brand.currency;
        }

        // Pesquisa configuração por usuário
        if (user.withdrawal_configs) {
            withdrawal_configs = user?.withdrawal_configs ?? null;
            withdrawal_configs.currency = brand?.currency ?? null;
        }

        return {
            status: 'success',
            data: formattedWallets,
            withdrawal_configs,
        };
    }

    async processSingleWallet(params: {
        wallet_id: number;
        cutoff: Date;
        brand_id?: number;
        user_id?: number;
    }) {

        const { wallet_id, cutoff, brand_id, user_id } = params;

        /*
        =====================================
        AGRUPAR TRANSACTIONS
        =====================================
        */
        const rows = await this.prisma.transaction.groupBy({
            by: ['currency', 'type'],
            where: {
                wallet_id,
                paid: false,
                created_at: { lte: cutoff },
                ...(brand_id && { brand_id }),
                ...(user_id && { user_id })
            },
            _sum: {
                amount: true
            }
        });

        if (!rows.length) return;

        /*
        =====================================
        MAPEAR MOEDAS
        =====================================
        */
        const currencyMap: Record<string, number> = {};

        for (const row of rows) {

            const amount = row._sum.amount ?? 0;
            const signed = row.type === 1 ? amount : -amount;

            if (!currencyMap[row.currency]) {
                currencyMap[row.currency] = 0;
            }

            currencyMap[row.currency] += signed;
        }

        /*
        =====================================
        PEGAR WALLET
        =====================================
        */
        const wallet = await this.prisma.wallet.findUnique({
            where: { id: wallet_id },
            select: { id: true, currency: true }
        });

        if (!wallet) return;

        /*
        =====================================
        CONVERTER
        =====================================
        */
        let total = 0;

        for (const [cur, amount] of Object.entries(currencyMap)) {

            if (amount === 0) continue;

            const result = await this.currencyService.convertCents(
                amount,
                cur,
                wallet.currency
            );

            total += result.cents;
        }

        if (total <= 0) return;

        /*
        =====================================
        TRANSACTION (ATÔMICO)
        =====================================
        */
        await this.prisma.$transaction(async (tx) => {

            await tx.wallet.update({
                where: { id: wallet_id },
                data: {
                    balance: {
                        increment: total
                    }
                }
            });

            await tx.transaction.updateMany({
                where: {
                    wallet_id,
                    paid: false,
                    created_at: { lte: cutoff },
                    ...(brand_id && { brand_id }),
                    ...(user_id && { user_id })
                },
                data: {
                    paid: true
                }
            });

        });

    }

    async getUserBalances(currency: string, currentUser: any) {

        const currency_data = {
            code: currency,
            prefix: this.currencyService.getCurrencyPrefix(currency)
        };

        const brand_id = currentUser.brand_id;
        const user_id = currentUser.id;

        /*
        =====================================
        WALLETS
        =====================================
        */

        const wallets = await this.prisma.wallet.groupBy({
            by: ['currency'],
            where: {
                brand_id,
                user_id
            },
            _sum: {
                balance: true
            }
        });

        /*
        =====================================
        OPEN TRANSACTIONS (paid = 0)
        =====================================
        */

        const transactions = await this.prisma.transaction.groupBy({
            by: ['currency', 'type'],
            where: {
                brand_id,
                user_id,
                paid: false
            },
            _sum: {
                amount: true
            }
        });

        /*
        =====================================
        HELPERS
        =====================================
        */

        const walletMap: Record<string, number> = {};
        const openMap: Record<string, number> = {};

        // wallets
        for (const w of wallets) {
            const amount = w._sum.balance ?? 0;
            if (!walletMap[w.currency]) walletMap[w.currency] = 0;
            walletMap[w.currency] += amount;
        }

        // transactions (entrada/saida)
        for (const t of transactions) {
            const amount = t._sum.amount ?? 0;
            const signed = t.type === 1 ? amount : -amount;

            if (!openMap[t.currency]) openMap[t.currency] = 0;
            openMap[t.currency] += signed;
        }

        /*
        =====================================
        CONVERT
        =====================================
        */

        const convertMap = async (map: Record<string, number>) => {
            let total = 0;
            for (const [cur, val] of Object.entries(map)) {
                const result = await this.currencyService.convertCents(
                    val,
                    cur,
                    currency
                );
                total += result.cents;
            }

            return total;
        };

        const walletTotal = await convertMap(walletMap);
        const openTotal = await convertMap(openMap);

        /*
        =====================================
        RESPONSE
        =====================================
        */

        return {
            status: 'success',
            currency_data,
            wallet_balance: {
                cents: walletTotal,
                formatted: realFormat(walletTotal)
            },
            open_balance: {
                cents: openTotal,
                formatted: realFormat(openTotal)
            }
        };

    }
}
