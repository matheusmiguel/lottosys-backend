import {
    Injectable,
    Scope,
    Inject,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
// 👇 importante: import type por causa do isolatedModules
import type { Request } from 'express';
import { AuthenticatedUser } from './decorators/current-user.decorator';

// tipo local que sabe que existe user na request
type RequestWithUser = Request & { user?: AuthenticatedUser };

// Esse service é recriado a cada request
@Injectable({ scope: Scope.REQUEST })
export class CurrentUserService {
    constructor(
        @Inject(REQUEST) private readonly request: RequestWithUser,
    ) { }

    getUser(): AuthenticatedUser {
        return this.request.user as AuthenticatedUser;
    }

    getUserId(): number | string {
        const user = this.getUser();
        return user?.id;
    }

    getPermissions(): string[] {
        const user = this.getUser();
        return user?.permissions ?? [];
    }

    hasPermission(permission: string): boolean {
        const permissions = this.getPermissions();
        return permissions.includes(permission);
    }
}
