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

export interface AuthTicketResponse {
  ticket: string;
  status?: AuthAccountStatus;
  role?: AuthAccountRole;
  accountType?: RegistrationAccountType;
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

async function postJson<TResponse, TInput>(path: string, input: TInput): Promise<TResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null) as { code?: unknown } | null;
    throw new AuthApiError(response.status, typeof data?.code === 'string' ? data.code : undefined);
  }

  return response.json() as Promise<TResponse>;
}

export function requestRegistration(input: RegistrationRequestInput) {
  return postJson<RegistrationRequestResponse, RegistrationRequestInput>('/api/auth/register/request', input);
}

export function verifyRegistration(input: RegistrationVerifyInput) {
  return postJson<AuthTicketResponse, RegistrationVerifyInput>('/api/auth/register/verify', input);
}

export function signInWithPassword(input: PasswordSignInInput) {
  return postJson<AuthTicketResponse, PasswordSignInInput>('/api/auth/sign-in', input);
}