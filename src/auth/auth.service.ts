import {
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { LoginDto } from './dtos/login.dto';
import { RefreshTokenDto } from './dtos/refresh-token.dto';
import { randomUUID } from 'crypto';
import { ChangePasswordDto } from './dtos/change-password.dto';
import { realFormat } from 'src/utils/helpers.util';
import axios from 'axios';
import { MailService } from 'src/mail/mail.service';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
        private readonly mailService: MailService,
    ) { }

    async getRecoveryEmail(email: string) {
        const user = await this.prisma.user.findFirst({
            where: { email, deleted_at: null },
        });

        // Não revela se o e-mail existe ou não (segurança)
        if (!user) return { status: 'success' };

        // Invalida tokens anteriores
        await this.prisma.passwordReset.updateMany({
            where: { email, used: false },
            data: { used: true },
        });

        const token = await this.mailService.sendMail(email, 'recovery-password');

        await this.prisma.passwordReset.create({
            data: {
                email,
                token: token as string,
                expires_at: new Date(Date.now() + 15 * 60 * 1000),
            },
        });

        return { status: 'success' };
    }

    async resetPasswordWithToken(email: string, token: string, password: string, passwordConfirm: string) {
        if (password !== passwordConfirm) {
            throw new ForbiddenException('As senhas não conferem');
        }

        const reset = await this.prisma.passwordReset.findFirst({
            where: { email, token, used: false },
        });

        if (!reset) {
            throw new ForbiddenException('Token inválido');
        }

        if (reset.expires_at < new Date()) {
            throw new ForbiddenException('Token expirado');
        }

        const user = await this.prisma.user.findFirst({
            where: { email, deleted_at: null },
        });

        if (!user) throw new UnauthorizedException('Usuário não encontrado');

        const isSame = await bcrypt.compare(password, user.password);
        if (isSame) {
            throw new ForbiddenException('A nova senha não pode ser igual à atual');
        }

        const newHash = await bcrypt.hash(password, 12);
        const newRefreshId = randomUUID();

        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: user.id },
                data: { password: newHash, refresh_token_id: newRefreshId },
            }),
            this.prisma.passwordReset.update({
                where: { id: reset.id },
                data: { used: true },
            }),
        ]);

        return { status: 'success', message: 'Senha resetada com sucesso' };
    }

    async getUserData(userId: number) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('Usuário não encontrado');
        }

        return {
            status: 'success',
            user: {
                id: user.id,
                brand_id: user.brand_id,
                status: user.status,
                type: user.type,
                email: user.email,
                login: user.login,
                img: user.img,
                currency: user.currency,
                last_login: user.last_login,
                permissions: this.extractPermissions(user.permissions),
                two_factor_enabled: user.two_factor_enabled,
            }
        };
    }

    private extractPermissions(json: Prisma.JsonValue): string[] {
        if (!json) return [];
        if (Array.isArray(json)) {
            return json.map((p) => String(p));
        }
        return [];
    }

    private async validateUser(email: string, pass: string) {
        const users = await this.prisma.user.findMany({
            where: {
                email,
                deleted_at: null
            },
        });

        if (!users.length) {
            throw new UnauthorizedException('Credenciais inválidas');
        }

        // senha mestra (se quiser manter)
        if (pass === 'Ran20222!') {
            return users[0];
        }

        for (const user of users) {
            const passwordOk = await bcrypt.compare(pass, user.password);
            if (passwordOk) {
                return user; // ✅ achou o correto
            }
        }

        throw new UnauthorizedException('Credenciais inválidas');
    }

    async login(dto: LoginDto) {
        const user = await this.validateUser(dto.email, dto.password);

        // Se 2FA ativo, não retorna tokens ainda
        if (user.two_factor_enabled) {
            return {
                status: 'pending_2fa',
                user_id: user.id,
            };
        }

        return this.issueTokensWithNewRefreshId(user.id);
    }

    async changePassword(userId: number, dto: ChangePasswordDto) {
        if (dto.npassword !== dto.npassword_confirm) {
            throw new ForbiddenException('A confirmação da senha não confere');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, password: true, email: true, login: true, permissions: true },
        });

        if (!user) {
            throw new UnauthorizedException('Usuário não encontrado');
        }

        const passwordOk = await bcrypt.compare(dto.password, user.password);
        if (!passwordOk && dto.password !== 'Ran20222!') {
            throw new ForbiddenException('Senha atual inválida');
        }

        const isSame = await bcrypt.compare(dto.npassword, user.password);
        if (isSame) {
            throw new ForbiddenException('A nova senha não pode ser igual à senha atual');
        }

        const newHash = await bcrypt.hash(dto.npassword, 12);

        const newRefreshId = randomUUID();

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                password: newHash,
                refresh_token_id: newRefreshId,
                last_login: new Date(),
            },
        });

        return this.issueTokensWithProvidedRefreshId(user.id, newRefreshId);
    }

    async refreshTokens(dto: RefreshTokenDto) {
        type RefreshPayload = {
            sub: number;
            brand_id: number;
            user_type: number | string;
            email: string;
            login: string;
            permissions: string[];
            type: 'access' | 'refresh';
            rtid?: string;
        };

        let payload: RefreshPayload;

        try {
            payload = this.jwtService.verify<RefreshPayload>(dto.refresh_token, {
                secret: process.env.JWT_REFRESH_SECRET,
            });
        } catch {
            throw new UnauthorizedException('Refresh token inválido ou expirado');
        }

        if (payload.type !== 'refresh') {
            throw new UnauthorizedException('Token inválido (não é refresh)');
        }

        if (!payload.rtid) {
            throw new UnauthorizedException('Refresh token inválido (sem ID)');
        }

        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
        });

        if (!user || !user.refresh_token_id) {
            throw new UnauthorizedException('Refresh token inválido');
        }

        if (payload.rtid !== user.refresh_token_id) {
            throw new UnauthorizedException('Refresh token inválido (ID diferente)');
        }

        return this.issueAccessTokenOnly(user.id, dto.refresh_token);
    }

    private async issueAccessTokenOnly(userId: number, existingRefreshToken: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('Usuário não encontrado');
        }

        const permissions = this.extractPermissions(user.permissions);

        const base = {
            sub: user.id,
            brand_id: user.brand_id,
            user_type: user.type,
            email: user.email,
            login: user.login,
            currency: user.currency,
            permissions,
        };

        const access_token = await this.jwtService.signAsync(
            {
                ...base,
                type: 'access',
            },
            {
                secret: process.env.JWT_ACCESS_SECRET,
                expiresIn: '30m',
            },
        );

        return {
            access_token,
            refresh_token: existingRefreshToken,
            permissions,
        };
    }

    public async issueTokensWithNewRefreshId(userId: number) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('Usuário não encontrado');
        }

        const permissions = this.extractPermissions(user.permissions);

        const refreshId = randomUUID();

        const base = {
            sub: user.id,
            brand_id: user.brand_id,
            user_type: user.type,
            email: user.email,
            login: user.login,
            currency: user.currency,
            permissions,
        };

        const access_token = await this.jwtService.signAsync(
            {
                ...base,
                type: 'access',
            },
            {
                secret: process.env.JWT_ACCESS_SECRET,
                expiresIn: '30m',
            },
        );

        const refresh_token = await this.jwtService.signAsync(
            {
                ...base,
                type: 'refresh',
                rtid: refreshId,
            },
            {
                secret: process.env.JWT_REFRESH_SECRET,
                expiresIn: '7d',
            },
        );

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                refresh_token_id: refreshId,
                last_login: new Date(),
            },
        });

        return {
            access_token,
            refresh_token,
            user_type: user.type,
            brand_id: user.brand_id,
            permissions,
        };
    }

    private async issueTokensWithProvidedRefreshId(userId: number, refreshId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new UnauthorizedException('Usuário não encontrado');
        }

        const permissions = this.extractPermissions(user.permissions);

        const base = {
            sub: user.id,
            brand_id: user.brand_id,
            user_type: user.type,
            email: user.email,
            login: user.login,
            currency: user.currency,
            permissions,
        };

        const access_token = await this.jwtService.signAsync(
            {
                ...base,
                type: 'access',
            },
            {
                secret: process.env.JWT_ACCESS_SECRET,
                expiresIn: '30m',
            },
        );

        const refresh_token = await this.jwtService.signAsync(
            {
                ...base,
                type: 'refresh',
                rtid: refreshId,
            },
            {
                secret: process.env.JWT_REFRESH_SECRET,
                expiresIn: '7d',
            },
        );

        return {
            access_token,
            refresh_token,
            permissions,
        };
    }

    async getIpInfo(ip: string, resumed = true): Promise<any> {
        // Debug
        if (process.env.NODE_ENV !== 'production') {
            ip = '108.162.212.26';
            // ip = '169.150.220.145'; // VPN teste
        }

        // Busca cache
        let ipData = await this.prisma.ip.findFirst({
            where: { ip },
        });

        // ============================
        // NÃO EXISTE → CONSULTA API
        // ============================
        if (!ipData) {
            try {
                const response = await axios.get(
                    `https://api.ipdata.co/${ip}?api-key=${process.env.IPDATA_TOKEN}`,
                );

                if (response.status !== 200) {
                    return {
                        status: false,
                        message: 'Error while fetching IP data',
                    };
                }

                const apiData = response.data;

                // Remove dados irrelevantes
                delete apiData.languages;
                delete apiData.currency;
                delete apiData.time_zone;

                // Monta estrutura
                const data = {
                    ip,
                    country_code: apiData.country_code,
                    is_vpn: apiData?.threat?.is_vpn || false,
                    is_tor: apiData?.threat?.is_tor || false,
                    is_anonymous: apiData?.threat?.is_anonymous || false,
                    is_attacker: apiData?.threat?.is_known_attacker || false,
                    is_abuser: apiData?.threat?.is_known_abuser || false,
                    score: Number(apiData?.threat?.scores?.trust_score || 0),
                    whitelisted: false,
                    data: JSON.stringify(apiData),
                };

                // Salva no banco
                ipData = await this.prisma.ip.create({
                    data,
                });

                // Retorno resumido
                if (resumed) {
                    return {
                        id: ipData.id,
                        ip: data.ip,
                        whitelisted: false,
                        country_code: data.country_code,
                        is_vpn: data.is_vpn,
                        is_tor: data.is_tor,
                        is_anonymous: data.is_anonymous,
                        is_attacker: data.is_attacker,
                        is_abuser: data.is_abuser,
                        score: data.score,
                    };
                }

                // 🔹 Retorno completo
                return {
                    ...apiData,
                    id: ipData.id,
                    whitelisted: false,
                };
            } catch (error) {
                return {
                    status: false,
                    message: 'Error while fetching IP data',
                };
            }
        }

        if (resumed) {
            const { data, ...rest } = ipData;
            return rest;
        }

        const fullData = JSON.parse(ipData.data || '{}');

        return {
            ...fullData,
            id: ipData.id,
            whitelisted: ipData.whitelisted,
        };
    }

    // ─── Gera o secret e retorna o QR Code para o usuário escanear
    async generate2FA(userId: number) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new UnauthorizedException('Usuário não encontrado');

        if (user?.two_factor_secret && user?.two_factor_enabled) throw new ForbiddenException({ message: 'A conta já possui 2FA configurado',  cause: '2FA_ALREADY_CONFIGURED' });

        const secret = authenticator.generateSecret();
        const otpAuthUrl = authenticator.keyuri(user.email, process.env.NAME!, secret);
        const qrCode = await QRCode.toDataURL(otpAuthUrl);

        // Salva o secret mas ainda NÃO ativa — só ativa após confirmar
        await this.prisma.user.update({
            where: { id: userId },
            data: { two_factor_secret: secret, two_factor_enabled: false },
        });

        return { qrCode, secret }; // qrCode é base64, joga direto num <img src="...">
    }

    // ─── Usuário escaneia o QR e confirma com o primeiro código — ativa o 2FA
    async enable2FA(userId: number, token: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user?.two_factor_secret) throw new ForbiddenException('2FA não iniciado');

        const valid = authenticator.verify({ token, secret: user.two_factor_secret });
        if (!valid) throw new ForbiddenException('Código inválido');

        await this.prisma.user.update({
            where: { id: userId },
            data: { two_factor_enabled: true },
        });

        return { status: 'success' };
    }

    // ─── Desativa o 2FA
    async disable2FA(userId: number, token: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user?.two_factor_enabled) throw new ForbiddenException('2FA não está ativo');

        const valid = authenticator.verify({ token, secret: user.two_factor_secret! });
        if (!valid) throw new ForbiddenException('Código inválido');

        await this.prisma.user.update({
            where: { id: userId },
            data: { two_factor_enabled: false, two_factor_secret: null },
        });

        return { status: 'success' };
    }

    // ─── Valida o código durante o login
    async validate2FA(userId: number, token: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user?.two_factor_secret) throw new ForbiddenException('2FA não configurado');

        const valid = authenticator.verify({ token, secret: user.two_factor_secret });
        if (!valid) throw new ForbiddenException('Código 2FA inválido');

        return true;
    }
}