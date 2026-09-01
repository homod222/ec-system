import { getStoredToken } from './auth-context';

export type RegistrationAccountType = 'guardian' | 'staff';

export interface RegistrationRequestInput {
  phone: string;
  fullName: string;
  email: string;
  accountType: RegistrationAccountType;
}

export interface RegistrationRequestResponse {
  challengeId: string;
}

export interface RegistrationVerifyInput {
  challengeId: string;
  otp: string;
  password: string;
}

export interface PasswordSignInInput {
  phone: string;
  password: string;
}

export type AuthAccountStatus = 'active' | 'pending';
export type AuthAccountRole = 'guardian' | 'parent' | 'staff' | 'admin' | 'pending' | string;

export interface AuthTokenResponse {
  token: string;
  accountId: number;
  fullName?: string;
  status?: AuthAccountStatus;
  role?: AuthAccountRole;
  accountType?: RegistrationAccountType;
  ownerId?: string;
}

export class AuthApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super('Authentication request failed');
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

/** Return Authorization header if a JWT is stored */
export function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface JwtClaims {
  sub?: string;
  role?: string;
  ownerId?: string | null;
}

function decodeJwtPayload(token: string): JwtClaims {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return {};
  }
}

async function postJson<TInput>(path: string, input: TInput): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null) as { code?: unknown } | null;
    throw new AuthApiError(response.status, typeof data?.code === 'string' ? data.code : undefined);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export function requestRegistration(input: RegistrationRequestInput) {
  return postJson('/api/auth/register/request', input) as unknown as Promise<RegistrationRequestResponse>;
}

export async function verifyRegistration(input: RegistrationVerifyInput): Promise<AuthTokenResponse> {
  const raw = await postJson('/api/auth/register/verify', input);
  const token = String(raw.ticket ?? raw.token ?? '');
  const claims = decodeJwtPayload(token);
  return {
    token,
    accountId: Number(claims.sub ?? raw.accountId ?? 0),
    fullName: typeof raw.fullName === 'string' ? raw.fullName : undefined,
    status: (raw.status as AuthAccountStatus) ?? (claims.role === 'pending' ? 'pending' : 'active'),
    role: (raw.role as AuthAccountRole) ?? claims.role,
    accountType: raw.accountType as RegistrationAccountType | undefined,
    ownerId: claims.ownerId ?? undefined,
  };
}

export async function signInWithPassword(input: PasswordSignInInput): Promise<AuthTokenResponse> {
  const raw = await postJson('/api/auth/sign-in', input);
  const token = String(raw.ticket ?? raw.token ?? '');
  const claims = decodeJwtPayload(token);
  return {
    token,
    accountId: Number(claims.sub ?? raw.accountId ?? 0),
    fullName: typeof raw.fullName === 'string' ? raw.fullName : undefined,
    status: (raw.status as AuthAccountStatus) ?? (claims.role === 'pending' ? 'pending' : 'active'),
    role: (raw.role as AuthAccountRole) ?? claims.role,
    accountType: raw.accountType as RegistrationAccountType | undefined,
    ownerId: claims.ownerId ?? undefined,
  };
}