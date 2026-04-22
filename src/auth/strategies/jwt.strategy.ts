import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
    sub: number | string;
    brand_id: number;
    user_type: string;
    email: string;
    login: string;
    permissions: string[];
    currency: string;
    type: 'access' | 'refresh';
    rtid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_ACCESS_SECRET,
        });
    }

    async validate(payload: JwtPayload) {
        // vira req.user
        return {
            id: payload.sub,
            brand_id: payload.brand_id ?? 0,
            user_type: payload.user_type ?? '',
            email: payload.email,
            login: payload.login ?? '',
            currency: payload.currency ?? '',
            permissions: payload.permissions ?? [],
        };
    }
}
