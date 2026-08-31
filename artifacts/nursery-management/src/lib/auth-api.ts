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

  constructor(status: number) {
    super('Authentication request failed');
    this.name = 'AuthApiError';
    this.status = status;
  }
}

async function postJson<TResponse, TInput>(path: string, input: TInput): Promise<TResponse> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new AuthApiError(response.status);
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