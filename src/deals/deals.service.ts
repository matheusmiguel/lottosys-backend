import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { stat } from 'fs';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { realFormat, realToCents } from 'src/utils/helpers.util';

@Injectable()
export class DealsService {

    constructor(
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService,
    ) { }

    async listDeals(currentUser: any) {
        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You cannot list deals!');
        }

        const deals = await this.prisma.deal.findMany({
            where: {
                brand_id: currentUser.brand_id,
                deleted_at: null
            },
            include: {
                admin: {
                    select: {
                        login: true
                    }
                },
                user: {
                    select: {
                        id: true,
                        login: true
                    }
                },
            },
            orderBy: {
                id: 'desc'
            }
        });

        const formattedDeals = deals.map(deal => ({
            ...deal,
            currency_prefix: this.currencyService.getCurrencyPrefix(deal.currency),
            cpa_amount: realFormat(deal.cpa_amount),
            cpa_percent: Number(deal.cpa_percent),
            deposit_amount: realFormat(deal.deposit_amount),
            deposit_percent: Number(deal.deposit_percent),
            lead_amount: realFormat(deal.lead_amount),
            lead_percent: Number(deal.lead_percent),
            click_amount: realFormat(deal.click_amount),
            click_percent: Number(deal.click_percent),
            revshare_percent: Number(deal.revshare_percent),
        }));

        return {
            status: 'success',
            data: formattedDeals
        };
    }

    async getDeal(id: number, currentUser: any) {
        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You cannot get deal details!');
        }

        const deal = await this.prisma.deal.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id,
                deleted_at: null
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        login: true,
                        email: true,
                    }
                },
            }
        });

        if (!deal) {
            throw new NotFoundException('Deal not found');
        }

        return {
            status: 'success',
            data: {
                ...deal,
                min_transaction_amount: realFormat(deal.min_transaction_amount),
                cpa_amount: realFormat(deal.cpa_amount),
                deposit_amount: realFormat(deal.deposit_amount),
                lead_amount: realFormat(deal.lead_amount),
                click_amount: realFormat(deal.click_amount),
            }
        };

    }

    async createDeal(dto: any, currentUser: any) {
        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You cannot create deals!');
        }

        // DTO Posterior
        dto.min_transaction_amount = realToCents(dto.min_transaction_amount) ?? 0;
        dto.deposit_amount = realToCents(dto.deposit_amount) ?? 0;
        dto.cpa_amount = realToCents(dto.cpa_amount) ?? 0;
        dto.deposit_percent = Number(dto.deposit_percent) ?? 0;
        dto.cpa_percent = Number(dto.cpa_percent) ?? 0;
        dto.revshare_percent = Number(dto.revshare_percent) ?? 0;

        const data = await this.prisma.deal.create({
            data: {
                brand_id: currentUser.brand_id,
                user_id: dto.user_id,
                admin_id: currentUser.id,

                name: dto.name,
                status: dto.status,
                currency: dto.currency,

                min_transaction_amount: dto.min_transaction_amount,

                click_amount: dto.click_amount ?? 0,
                click_percent: dto.click_percent ?? 0,

                lead_amount: dto.lead_amount ?? 0,
                lead_percent: dto.lead_percent ?? 0,

                deposit_amount: dto.deposit_amount ?? 0,
                deposit_percent: dto.deposit_percent ?? 0,

                cpa_amount: dto.cpa_amount ?? 0,
                cpa_percent: dto.cpa_percent ?? 0,

                revshare_percent: dto.revshare_percent ?? 0
            }
        });

        return {
            status: 'success',
            message: 'Deal created successfully',
            data: data
        };

    }

    async updateDeal(id: number, dto: any, currentUser: any) {
        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You cannot update deals!');
        }

        // DTO Posterior
        dto.min_transaction_amount = realToCents(dto.min_transaction_amount) ?? 0;
        dto.deposit_amount = realToCents(dto.deposit_amount) ?? 0;
        dto.cpa_amount = realToCents(dto.cpa_amount) ?? 0;
        dto.deposit_percent = Number(dto.deposit_percent) ?? 0;
        dto.cpa_percent = Number(dto.cpa_percent) ?? 0;
        dto.revshare_percent = Number(dto.revshare_percent) ?? 0;

        const deal = await this.prisma.deal.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!deal) {
            throw new NotFoundException('Deal not found');
        }

        let updated_deal = await this.prisma.deal.update({
            where: { id },
            data: {

                name: dto.name,
                status: dto.status,
                user_id: dto.user_id,

                min_transaction_amount: dto.min_transaction_amount,

                click_amount: dto.click_amount,
                click_percent: dto.click_percent,

                lead_amount: dto.lead_amount,
                lead_percent: dto.lead_percent,

                deposit_amount: dto.deposit_amount,
                deposit_percent: dto.deposit_percent,
                currency: dto.currency,

                cpa_amount: dto.cpa_amount,
                cpa_percent: dto.cpa_percent,

                revshare_percent: dto.revshare_percent

            }
        });

        return {
            status: 'success',
            message: 'Deal updated successfully',
            data: {
                ...updated_deal,
            }
        }
    }

    async deleteDeal(id: number, currentUser: any) {
        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You cannot delete deals!');
        }

        const deal = await this.prisma.deal.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!deal) {
            throw new NotFoundException('Deal not found');
        }

        await this.prisma.deal.update({
            where: { id },
            data: {
                deleted_at: new Date()
            }
        });

        return {
            status: 'success',
            message: 'Deal deleted successfully!'
        };

    }

    async updateStatus(id: number, status: number, currentUser: any) {
        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2) {
            throw new BadRequestException('You cannot update deal status!');
        }

        const deal = await this.prisma.deal.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!deal) {
            throw new NotFoundException('Deal not found');
        }

        return this.prisma.deal.update({
            where: { id },
            data: { status }
        });

    }
}
