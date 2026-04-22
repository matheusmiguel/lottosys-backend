import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { PERMISSIONS } from 'src/auth/permissions';
import { isStringArray, realToCents, sanitizePermissions } from 'src/utils/helpers.util';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

@Injectable()
export class UsersService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    async searchUsers(q: string, currentUser: any) {

        if (!q || q.length < 3) {
            return {
                status: 'success',
                data: []
            };
        }

        let where: any = {
            site_id: currentUser.site_id,
            deleted_at: null,
            OR: [
                { name: { contains: q } },
                { login: { contains: q } },
                { email: { contains: q } }
            ]
        };

        let userIds: number[] = [];

        if (currentUser.user_type > 2) {
            userIds = await this.getManagerTreeIds(
                currentUser.id,
                currentUser.site_id
            );

            // remove ele mesmo
            userIds = userIds.filter(id => id !== currentUser.id);
            where.id = { in: userIds };
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
        if ((dto.type <= currentUser.user_type && currentUser.user_type > 2 && dto.type !== 10) || dto.type === 1) {
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

        // Configurações da site
        const site = await this.prisma.site.findUnique({
            where: {
                id: currentUser.site_id
            }
        });

        if (!site) {
            throw new BadRequestException('Site not found!');
        }

        // Pesquisa usuários da mesma site com mesmos dados
        const existingUser = await this.prisma.user.findFirst({
            where: {
                site_id: currentUser.site_id,
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

        try {
            const user = await this.prisma.user.create({
                data: {
                    site_id: currentUser.site_id,
                    validated: true,
                    region_id: dto.region || 0,
                    status: 1,
                    type: dto.type,
                    manager_id: parent_id,
                    name: dto.name,
                    login: dto.login,
                    email: dto.email,
                    phone: dto.phone,
                    document: dto.document,
                    password: password,
                    permissions: permissions,
                }
            });

            return {
                status: 'success',
                message: 'User created successfully',
                data: {
                    id: user.id,
                    site_id: user.site_id,
                    manager_id: user.manager_id,
                    type: user.type,
                    status: user.status,
                    email: user.email,
                    name: user.name,
                    login: user.login,
                    phone: user.phone,
                    document: user.document,
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
            site_id: currentUser.site_id,
            deleted_at: null
        };

        if (user_type > 0) {
            where.type = user_type;
        }

        let affiliateIds: number[] = [];
        if (currentUser.user_type > 2) {
            // Lista árvore de afiliados
            affiliateIds = await this.getManagerTreeIds(currentUser.id, currentUser.site_id);

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
                    manager_id: true,
                    type: true,
                    status: true,
                    name: true,
                    login: true,
                    email: true,
                    phone: true,
                    document: true,
                    img: true,
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
    async getUser(id: number, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            select: {
                id: true,
                site_id: true,
                manager_id: true,
                type: true,
                status: true,
                email: true,
                name: true,
                login: true,
                phone: true,
                document: true,
                permissions: true,
            },
            where: {
                id,
                site_id: currentUser.site_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita listar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2 && user.manager_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this user!');
        }

        const site = await this.prisma.site.findFirst({
            where: {
                id: currentUser.site_id
            },
            select: {
                id: true,
                name: true,
            }
        });

        return {
            status: 'success',
            data: {
                ...user,
                permissions_full: this.mapPermissions((user.permissions as string[]) || [], currentUser.permissions as string[]),
                site
            }
        };
    }

    // UPDATE PERMISSIONS
    async updateUserPermissions(id: number, permission: string, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                site_id: currentUser.site_id
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
    async updateUser(id: number, dto: UpdateUserDto, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                site_id: currentUser.site_id
            }
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Evita alterar usuários do mesmo tipo ou superior ao do usuário atual
        if (user.type <= currentUser.user_type && currentUser.user_type > 2 && user.manager_id !== currentUser.id) {
            throw new BadRequestException('You don\'t have permission to view this user!');
        }

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

        const updated = await this.prisma.user.update({
            where: {
                id
            },
            data: {
                email: dto.email,
                phone: dto.phone,
                status: dto.status,
                type: dto.type,
                user_token,
                password: password,
            }
        });

        return {
            status: 'success',
            data: {
                id: updated.id,
                site_id: updated.site_id,
                manager_id: updated.manager_id,
                type: updated.type,
                status: updated.status,
                email: updated.email,
                name: updated.name,
                login: updated.login,
                phone: updated.phone,
                document: updated.document,
                permissions: updated.permissions,
            }
        };
    }

    // DELETE
    async deleteUser(id: number, currentUser: any) {

        const user = await this.prisma.user.findFirst({
            where: {
                id,
                site_id: currentUser.site_id
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
                site_id: currentUser.site_id
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

    async getManagerTreeIds(rootId: number, site_id: number): Promise<number[]> {

        const users = await this.prisma.user.findMany({
            where: {
                site_id,
            },
            select: {
                id: true,
                manager_id: true
            }
        });

        const tree: Record<number, number[]> = {};

        for (const u of users) {

            if (!u.manager_id) continue;

            if (!tree[u.manager_id]) {
                tree[u.manager_id] = [];
            }

            tree[u.manager_id].push(u.id);
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
