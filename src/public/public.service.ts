import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserLinkDto } from './dtos/create-user-link.dto';
import * as bcrypt from 'bcrypt';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class PublicService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authService: AuthService,
        private readonly usersService: UsersService
    ) { }

    // CREATE
    async createUserFromLink(dto: CreateUserLinkDto) {
        // Pega dados do current
        const admin = await this.prisma.user.findFirst({
            where: {
                user_token: dto.token
            }
        });

        if (!admin) {
            throw new BadRequestException('Referral not found!');
        }

        // Configurações da site
        const site = await this.prisma.site.findUnique({
            where: {
                id: admin.site_id
            }
        });

        if (!site) {
            throw new BadRequestException('Site not found!');
        }

        // Pesquisa usuários da mesma site com mesmos dados
        const existingUser = await this.prisma.user.findFirst({
            where: {
                site_id: admin.site_id,
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
        const permissions = this.usersService.getPermissionsByType(4);
        const parent_id = admin.type > 2 ? admin.id : 0;

        try {
            const user = await this.prisma.user.create({
                data: {
                    site_id: admin.site_id,
                    validated: true,
                    status: 1,
                    type: 10,
                    manager_id: parent_id,
                    name: dto?.name ?? '',
                    login: dto?.login ?? dto.email,
                    email: dto.email,
                    phone: dto?.phone ?? '',
                    document: dto?.document ?? '',
                    password: password,
                    permissions: permissions,
                }
            });

            // Loga usuário
            const login = await this.authService.issueTokensWithNewRefreshId(user.id);

            return {
                status: 'success',
                message: 'User created successfully',
                access_token: login.access_token ?? '',
                refresh_token: login.refresh_token ?? '',
                permissions: login.permissions ?? [],
            };
        } catch (error) {
            console.error('Error creating user:', error);
            throw new BadRequestException('An error occurred while creating the user.');
        }
    }

    async getLinkData(token: string) {
        // Pesquisa usuário
        const user = await this.prisma.user.findFirst({
            where: { user_token: token },
            select: {
                id: true,
                site_id: true,
                login: true,
                user_token: true
            }
        });

        if (!user) {
            throw new BadRequestException('Referral not found');
        }

        const site = await this.prisma.site.findUnique({
            where: { id: user.site_id },
            select: {
                name: true,
                url: true,
            }
        });

        if (!site) {
            throw new BadRequestException('Site not found');
        }

        return {
            token: user.user_token,
            site: {
                name: site.name,
                url: site.url,
            },
        };

    }
}
