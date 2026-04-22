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

        // Configurações da brand
        const brand = await this.prisma.brand.findUnique({
            where: {
                id: admin.brand_id
            }
        });

        if (!brand) {
            throw new BadRequestException('Brand not found!');
        }

        // Pesquisa usuários da mesma brand com mesmos dados
        const existingUser = await this.prisma.user.findFirst({
            where: {
                brand_id: admin.brand_id,
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
        const ngr_percent = admin.type > 2 ? admin.ngr_percent : (brand.ngr_percent || 0);

        try {
            const user = await this.prisma.user.create({
                data: {
                    brand_id: admin.brand_id,
                    validated: true,
                    confirmed: (brand.affiliate_signup_auto_approve) ? true : false,
                    status: 1,
                    type: 4,
                    validation_2fa: 0,
                    manager_id: 0,
                    parent_affiliate_id: parent_id,
                    name: dto?.name ?? '',
                    login: dto?.login ?? dto.email,
                    email: dto.email,
                    phone: dto?.phone ?? '',
                    document: dto?.document ?? '',
                    password: password,
                    currency: brand?.currency ?? 'usd',
                    ngr_percent: ngr_percent,
                    permissions: permissions,
                }
            });

            // Cria carteira
            await this.prisma.wallet.create({
                data: {
                    brand_id: admin.brand_id,
                    user_id: user.id,
                    name: 'Carteira Principal',
                    currency: brand?.currency ?? 'usd',
                    description: '',
                    balance: 0,
                    status: 1
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
                brand_id: true,
                login: true,
                user_token: true
            }
        });

        if (!user) {
            throw new BadRequestException('Referral not found');
        }

        const brand = await this.prisma.brand.findUnique({
            where: { id: user.brand_id },
            select: {
                name: true,
                url: true,
                affiliate_auto_signup: true,
            }
        });

        if (!brand) {
            throw new BadRequestException('Brand not found');
        }

        // Se brand não permite auto cadastro
        if (!brand.affiliate_auto_signup) {
            throw new UnauthorizedException('Brand does not allow auto signup');
        }

        return {
            token: user.user_token,
            brand: {
                name: brand.name,
                url: brand.url,
            },
        };

    }
}
