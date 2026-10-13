import { SetMetadata } from '@nestjs/common';
import type { ProtectCategory } from './arcjet.policies';

export const PROTECT_KEY = 'aurex:protect-category';
/**
 * Declares the protection category of a route (rate limits, Shield, bot rules). Routes with a user-scoped
 * category are also authenticated by ProtectGuard (so per-user limits use the verified session user).
 * Routes without the decorator get the strict 'default' (IP based) policy.
 */
export const Protect = (category: ProtectCategory) => SetMetadata(PROTECT_KEY, category);
