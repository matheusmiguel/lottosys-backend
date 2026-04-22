import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrencyService } from 'src/currency/currency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { AffiliatesService } from 'src/affiliates/affiliates.service';
import { PERMISSIONS } from 'src/auth/permissions';
import { isStringArray, realToCents, sanitizePermissions } from 'src/utils/helpers.util';
import * as bcrypt from 'bcrypt';
import { UpdateSubcommissionsDto } from './dtos/update-subcommissions.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class UsersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly currencyService: CurrencyService,
        private readonly affiliatesService: AffiliatesService,
    ) { }

    async searchUsers(q: string, currentUser: any) {

        if (!q || q.length < 3) {
            return {
                status: 'success',
                data: []
            };
        }

        let where: any = {
            brand_id: currentUser.brand_id,
            deleted_at: null,
            OR: [
                { name: { contains: q } },
                { login: { contains: q } },
                { email: { contains: q } }
            ]
        };

        let affiliateIds: number[] = [];

        if (currentUser.user_type > 2) {
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(
                currentUser.id,
                currentUser.brand_id
            );

            // remove ele mesmo
            affiliateIds = affiliateIds.filter(id => id !== currentUser.id);
            where.id = { in: affiliateIds };
        }

        const users = await this.prisma.user.findMany({
            where,
            select: {
                id: true,
                name: true,
                login: true,
                email: true
            },
            take: 20,
            orderBy: {
                login: 'asc'
            }
        });

        return {
            status: 'success',
            data: users
        };
    }

    // CREATE
    async createUser(dto: CreateUserDto, currentUser: any) {
        // Bloqueia criação de usuários do mesmo tipo ou superior ao do usuário atual
        if ((dto.type <= currentUser.user_type && currentUser.user_type > 2 && dto.type !== 4) || dto.type === 1) {
            throw new BadRequestException('You cannot create users with the same or higher type than yours!');
        }

        // Pega dados do current
        const admin = await this.prisma.user.findUnique({
            where: {
                id: currentUser.id
            }
        });

        if (!admin) {
            throw new BadRequestException('User not found!');
        }

        // Configurações da brand
        const brand = await this.prisma.brand.findUnique({
            where: {
                id: currentUser.brand_id
            }
        });

        if (!brand) {
            throw new BadRequestException('Brand not found!');
        }

        // Pesquisa usuários da mesma brand com mesmos dados
        const existingUser = await this.prisma.user.findFirst({
            where: {
                brand_id: currentUser.brand_id,
                OR: [
                    { login: dto.login },
                    { email: dto.email }
                ],
                deleted_at: null
            }
        });

        if (existingUser) {
            throw new BadRequestException('User with the same login or e-mail already exists!');
        }

        const password = await bcrypt.hash(dto.password, 12);
        const permissions = this.getPermissionsByType(dto.type);
        const parent_id = admin.type > 2 ? admin.id : 0;
        const ngr_percent = admin.type > 2 ? admin.ngr_percent : (dto.ngr_percent || 0);

        try {
            const user = await this.prisma.user.create({
                data: {
                    brand_id: currentUser.brand_id,
                    validated: true,
                    confirmed: true,
                    status: 1,
                    type: dto.type,
                    validation_2fa: 0,
                    manager_id: 0,
                    parent_affiliate_id: parent_id,
                    name: dto.name,
                    login: dto.login,
                    email: dto.email,
                    phone: dto.phone,
                    document: dto.document,
                    password: password,
                    currency: dto.currency,
                    ngr_percent: ngr_percent,
                    permissions: permissions,
                }
            });

            // Cria carteira
            await this.prisma.wallet.create({
                data: {
                    brand_id: currentUser.brand_id,
                    user_id: user.id,
                    name: 'Carteira Principal',
                    currency: dto.currency,
                    description: '',
                    balance: 0,
                    status: 1
                }
            });

            return {
                status: 'success',
                message: 'User created successfully',
                data: {
                    id: user.id,
                    brand_id: user.brand_id,
                    confirmed: user.confirmed,
                    type: user.type,
                    status: user.status,
                    email: user.email,
                    name: user.name,
                    login: user.login,
                    phone: user.phone,
                    document: user.document,
                    currency: user.currency,
                    ngr_percent: user.ngr_percent,
                    parent_affiliate_id: user.parent_affiliate_id,
                    permissions: user.permissions,
                }
            };
        } catch (error) {
            console.error('Error creating user:', error);
            throw new BadRequestException('An error occurred while creating the user.');
        }
    }

    // LIST
    async listUsers(
        user_type: number,
        search_type: string,
        q: string,
        page: number = 1,
        limit: number = 50,
        currentUser: any
    ) {
        const skip = (page - 1) * limit;
        let where: any = {
            brand_id: currentUser.brand_id,
            deleted_at: null
        };

        if (user_type > 0) {
            where.type = user_type;
        }

        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            // Lista árvore de afiliados
            affiliateIds = await this.affiliatesService.getAffiliateTreeIds(currentUser.id, currentUser.brand_id);

            // Remove próprio ID
            affiliateIds = affiliateIds.filter(id => id !== currentUser.id);
            where.id = { in: affiliateIds };
        }

        if (q && search_type) {
            switch (search_type) {

                case 'name':
                    where.name = {
                        contains: q
                    };
                    break;

                case 'login':
                    where.login = {
                        contains: q
                    };
                    break;

                case 'document':
                    where.document = {
                        contains: q
                    };
                    break;

                case 'email':
                    where.email = {
                        contains: q
                    };
                    break;

                case 'phone':
                    where.phone = {
                        contains: q
                    };
                    break;
            }
        }

        const [users, total] = await this.prisma.$transaction([
            this.prisma.user.findMany({
                where,
                select: {
                    id: true,
                    confirmed: true,
                    type: true,
                    status: true,
                    name: true,
                    login: true,
                    email: true,
                    phone: true,
                    document: true,
                    img: true,
                    parent_affiliate_id: true,
                    created_at: true
                },
                orderBy: {
                    id: 'desc'
                },
                skip,
                take: limit
            }),
            this.prisma.user.count({
                where
            })
        ]);

        return {
            status: 'success',
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit)
            },
            data: users
        };
    }

    // GET
    async getUserSubCommissions(id: number, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            select: {
                id: true,
                brand_id: true,
                type: true,
                status: true,
                email: true,
                login: true,
                parent_affiliate_id: true,
                sub_commissions: true,
            },
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Se não for sub-afiliado
        if (user.parent_affiliate_id === 0) {
            throw new BadRequestException('This user is not a sub-affiliate!');
        }

        // Evita listar usuários do mesmo tipo ou superior ao do usuário atual
        if (currentUser.user_type > 2 && user.parent_affiliate_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this user!');
        }

        // Pega afiliado pai
        const affiliate = await this.prisma.user.findFirst({
            where: {
                id: user.parent_affiliate_id
            }
        });

        return {
            status: 'success',
            data: {
                ...user,
                parent: {
                    id: affiliate?.id,
                    name: affiliate?.name,
                    email: affiliate?.email,
                    login: affiliate?.login,
                }
            }
        };
    }

    // GET
    async getUser(id: number, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            select: {
                id: true,
                brand_id: true,
                confirmed: true,
                type: true,
                status: true,
                email: true,
                name: true,
                login: true,
                phone: true,
                document: true,
                currency: true,
                ngr_percent: true,
                parent_affiliate_id: true,
                sub_commissions: true,
                permissions: true,
                withdrawal_configs: true,
            },
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita listar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2 && user.parent_affiliate_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this user!');
        }

        const brand = await this.prisma.brand.findFirst({
            where: {
                id: currentUser.brand_id
            },
            select: {
                id: true,
                currency: true,
                withdrawal_configs: true,
            }
        });

        return {
            status: 'success',
            data: {
                ...user,
                permissions_full: this.mapPermissions((user.permissions as string[]) || [], currentUser.permissions as string[]),
                brand
            }
        };
    }

    // UPDATE PERMISSIONS
    async updateUserPermissions(id: number, permission: string, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2) {
            throw new BadRequestException('You cannot update users with the same or higher type than yours!');
        }

        // Se já tem a permissão, remove. Se não tem, adiciona
        const permissions = isStringArray(user.permissions) ? user.permissions : [];
        let updatedPermissions: string[] = [];
        if (permissions.includes(permission)) {
            updatedPermissions = permissions.filter(p => p !== permission);
        } else {
            updatedPermissions = [...permissions, permission];
        }

        const updated = await this.prisma.user.update({
            where: {
                id
            },
            data: {
                permissions: sanitizePermissions(updatedPermissions)
            }
        });

        return {
            status: 'success',
            permissions: updated.permissions
        };
    }

    // UPDATE
    async updateUserSubcommissions(id: number, dto: UpdateSubcommissionsDto, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2 && user.parent_affiliate_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to edit this user!');
        }

        const updated = await this.prisma.user.update({
            where: {
                id
            },
            data: {
                sub_commissions: JSON.parse(JSON.stringify(dto)),
            }
        });

        return {
            status: 'success',
            data: null
        };
    }

    // UPDATE
    async updateUser(id: number, dto: UpdateUserDto, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2 && user.parent_affiliate_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this user!');
        }

        const ngr_percent = dto.ngr_percent !== undefined ? dto.ngr_percent : user.ngr_percent;

        // Definição de senha
        let password: string | undefined = undefined;
        if (dto.password) {
            password = await bcrypt.hash(dto.password, 12);
        } else {
            password = user.password;
        }

        // Definição de token
        let user_token: string | null = user.user_token;
        if (!user_token) {
            user_token = randomUUID();
        }

        // Ajuste
        if(dto.withdrawal_configs?.min_amount){
            dto.withdrawal_configs.min_amount = realToCents(dto.withdrawal_configs.min_amount);
        }

        const updated = await this.prisma.user.update({
            where: {
                id
            },
            data: {
                email: dto.email,
                phone: dto.phone,
                currency: dto.currency,
                status: dto.status,
                type: dto.type,
                ngr_percent: ngr_percent,
                user_token,
                password: password,
                withdrawal_configs: dto.withdrawal_configs ?? null,
            }
        });

        return {
            status: 'success',
            data: {
                id: updated.id,
                brand_id: updated.brand_id,
                confirmed: updated.confirmed,
                type: updated.type,
                status: updated.status,
                email: updated.email,
                name: updated.name,
                login: updated.login,
                phone: updated.phone,
                document: updated.document,
                currency: updated.currency,
                ngr_percent: updated.ngr_percent,
                parent_affiliate_id: updated.parent_affiliate_id,
                permissions: updated.permissions,
            }
        };
    }

    // DELETE
    async deleteUser(id: number, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita deletar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2) {
            throw new BadRequestException('You cannot delete users with the same or higher type than yours!');
        }

        await this.prisma.user.update({
            where: { id },
            data: { deleted_at: new Date() }
        });

        return {
            status: 'success',
            message: 'User deleted successfully!'
        };
    }

    async updateUserStatus(
        id: number,
        currentUser: any
    ) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2) {
            throw new BadRequestException('You cannot update users with the same or higher type than yours!');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.manager_id !== currentUser.id && currentUser.user_type > 2) {
            throw new BadRequestException('You cannot update users that are not your subordinates!');
        }

        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                status: user.status === 1 ? 0 : 1
            }
        });

        return {
            status: 'success',
            data: updated
        };
    }

    async confirmUser(
        id: number,
        currentUser: any
    ) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                brand_id: currentUser.brand_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2) {
            throw new BadRequestException('You cannot update users with the same or higher type than yours!');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.manager_id !== currentUser.id && currentUser.user_type > 2) {
            throw new BadRequestException('You cannot update users that are not your subordinates!');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.confirmed) {
            throw new BadRequestException('This user is already confirmed!');
        }

        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                confirmed: true,
                status: 1
            }
        });

        return {
            status: 'success',
            data: updated
        };
    }

    private mapPermissions(userPermissions: string[], currentUserPermissions: string[] = []) {
        // Confere se usuário tem permissão
        if (!currentUserPermissions.includes('adm.manperms')) {
            return null;
        }

        return Object.values(PERMISSIONS).map(group => ({
            code: group.code,
            label: group.label,
            permissions: group.permissions.map(p => ({
                id: `${group.code}_${p.key}`,
                key: p.key,
                label: p.label,
                enabled: userPermissions.includes(p.key)
            }))
        }));
    }

    public getPermissionsByType(type: number): string[] {
        const result: string[] = [];

        Object.values(PERMISSIONS).forEach(group => {
            group.permissions.forEach(permission => {
                if (permission.default_in.includes(type)) {
                    result.push(permission.key);
                }
            });
        });

        return result;
    }
}
