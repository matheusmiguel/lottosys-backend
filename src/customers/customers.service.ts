import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SetManagerDto } from './dtos/SetManagerDto';

@Injectable()
export class CustomersService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    async setManager(dto: SetManagerDto, currentUser: any) {
        const customer = await this.prisma.customer.findUnique({
            where: {
                id: dto.customer_id,
                site_id: currentUser.site_id
            }
        });

        if (!customer) {
            throw new NotFoundException('Customer not found!');
        }

        const updated = await this.prisma.customer.update({
            where: {
                id: dto.customer_id
            },
            data: {
                user_id: dto.manager_id,
            }
        });

        return {
            status: 'success',
            message: 'Customer updated successfully!',
        };
    }

    async listCustomers(
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
            site_id: currentUser.site_id
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
            where.user_id = currentUser.id;

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

        const [customers, total] = await this.prisma.$transaction([
            this.prisma.customer.findMany({
                where,
                select: {
                    id: true,
                    user_id: true,
                    name: true,
                    email: true,
                    phone: true,
                    document: true,

                    user: {
                        select: {
                            id: true,
                            login: true,
                            email: true,
                            img: true,
                        }
                    }
                },
                orderBy: {
                    created_at: 'desc'
                },
                skip,
                take: limit
            }),
            this.prisma.customer.count({
                where
            })
        ]);

        const sanitized = customers.map((item) => ({
            ...item,
            email: permissions.email ? item.email : null,
            name: permissions.name ? item.name : 'User ' + item.id,
            phone: permissions.phone ? item.phone : null,
            document: permissions.document ? item.document : null,

            user: item.user ? {
                id: item.user.id,
                login: item.user.login ?? null,
                email: item.user.email ?? null,
                img: item.user.img ?? null
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
