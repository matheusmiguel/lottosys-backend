import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { SetAffiliateDto } from './dtos/SetAffiliateDto';

@Injectable()
export class RegistrationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService
    ) { }

    async setAffiliate(dto: SetAffiliateDto, currentUser: any) {
        const registration = await this.prisma.registration.findUnique({
            where: {
                id: dto.lead_id,
                brand_id: currentUser.brand_id
            }
        });

        if (!registration) {
            throw new NotFoundException('Lead not found!');
        }

        const link = await this.prisma.link.findUnique({
            where: {
                id: dto.link_id,
                brand_id: currentUser.brand_id
            }
        });

        if (!link) {
            throw new NotFoundException('Link not found!');
        }

        const updated = await this.prisma.registration.update({
            where: {
                id: dto.lead_id
            },
            data: {
                affiliate_id: dto.affiliate_id,
                link_id: dto.link_id,
                deal_id: link.deal_id
            }
        });

        return {
            status: 'success',
            message: 'Lead updated successfully!',
        };
    }

    async listRegistrations(
        search_type: string,
        q: string,
        page: number = 1,
        limit: number = 50,
        currentUser: any,
        date_start?: string,
        date_end?: string,
    ) {

        const skip = (page - 1) * limit;

        const where: any = {
            brand_id: currentUser.brand_id
        };
        const fieldPermissionsMap = {
            email: 'ld.v_email',
            name: 'ld.v_name',
            login: 'ld.v_login',
            document: 'ld.v_doc',
            phone: 'ld.v_phone',
        };
        let permissions = {
            email: true,
            login: true,
            name: true,
            document: true,
            phone: true,
        }

        // Se for afiliado, só vê suas próprias conversões
        if (currentUser.user_type > 2) {
            where.affiliate_id = currentUser.id;

            // ######### Checa permissões do afiliado #########
            Object.keys(fieldPermissionsMap).forEach((field) => {
                const perm = fieldPermissionsMap[field];

                if (!this.hasPermission(currentUser, perm)) {
                    permissions[field] = false;
                }
            });
        }

        // filtro por data
        if (date_start || date_end) {

            where.signup_date = {};

            if (date_start) {
                where.signup_date.gte = new Date(`${date_start} 00:00:00`);
            }

            if (date_end) {
                where.signup_date.lte = new Date(`${date_end} 23:59:59`);
            }
        }

        // filtro de busca
        if (q && search_type) {
            // ✅ Verifica se o campo pesquisado tem permissão antes de aplicar o filtro
            const searchPermissionMap: Record<string, string> = {
                email: 'ld.v_email',
                name: 'ld.v_name',
                login: 'ld.v_login',
                document: 'ld.v_doc',
                phone: 'ld.v_phone',
            };

            const requiredPermission = searchPermissionMap[search_type];
            const canSearch = !requiredPermission || permissions[search_type];

            if (!canSearch) {
                throw new ForbiddenException(`You don't have permission to search by ${search_type}.`);
            }

            switch (search_type) {
                case 'id': where.id = Number(q); break;
                case 'login': where.login = { contains: q }; break;
                case 'name': where.name = { contains: q }; break;
                case 'document': where.document = { contains: q }; break;
                case 'email': where.email = { contains: q }; break;
            }
        }

        const [registrations, total] = await this.prisma.$transaction([
            this.prisma.registration.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    login: true,
                    email: true,
                    phone: true,
                    document: true,
                    img: true,
                    signup_date: true,
                    affiliate_id: true,
                    link_id: true,

                    link: {
                        select: {
                            id: true,
                            name: true
                        }
                    },

                    affiliate: {
                        select: {
                            id: true,
                            login: true,
                            email: true,
                            img: true,
                        }
                    }
                },
                orderBy: {
                    signup_date: 'desc'
                },
                skip,
                take: limit
            }),
            this.prisma.registration.count({
                where
            })
        ]);

        const sanitized = registrations.map((item) => ({
            ...item,
            email: permissions.email ? item.email : null,
            login: permissions.login ? item.login : null,
            name: permissions.name ? item.name : 'User ' + item.id,
            phone: permissions.phone ? item.phone : null,
            document: permissions.document ? item.document : null,

            link: item.link ? {
                id: item.link.id,
                name: item.link.name
            } : null,

            affiliate: item.affiliate ? {
                id: item.affiliate.id,
                login: item.affiliate.login ?? null,
                email: item.affiliate.email ?? null,
                img: item.affiliate.img ?? null
            } : null
        }));

        return {
            status: 'success',
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit)
            },
            data: sanitized
        };
    }

    hasPermission(user: any, permission: string): boolean {
        return user?.permissions?.includes(permission);
    }
}
