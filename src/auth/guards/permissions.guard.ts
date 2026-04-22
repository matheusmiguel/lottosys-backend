import {
    CanActivate,
    ExecutionContext,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PERMISSIONS_ANY_KEY } from '../decorators/permissions.decorator';
import { setConsumer } from 'apitally/nestjs';

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredAll = this.reflector.getAllAndOverride<string[]>(
            PERMISSIONS_KEY,
            [context.getHandler(), context.getClass()],
        );

        const requiredAny = this.reflector.getAllAndOverride<string[]>(
            PERMISSIONS_ANY_KEY,
            [context.getHandler(), context.getClass()],
        );

        // Se não tem nenhuma regra, libera
        if ((!requiredAll || requiredAll.length === 0) &&
            (!requiredAny || requiredAny.length === 0)) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || !user.permissions) {
            return false;
        }

        // APITally
        setConsumer(request, user.login);

        const userPermissions: string[] = user.permissions;

        // 🔹 AND (todas)
        if (requiredAll && requiredAll.length > 0) {
            const hasAll = requiredAll.every(permission =>
                userPermissions.includes(permission),
            );

            if (!hasAll) return false;
        }

        // 🔹 OR (qualquer uma)
        if (requiredAny && requiredAny.length > 0) {
            const hasAny = requiredAny.some(permission =>
                userPermissions.includes(permission),
            );

            if (!hasAny) return false;
        }

        return true;
    }
}
