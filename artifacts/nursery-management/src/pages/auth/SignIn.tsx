import { useState } from 'react';
import { useClerk } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { usePasswordLogin } from '@workspace/api-client-react';
import { useI18n } from '@/i18n';
import { Button } from '@/App';
import { LockKeyhole, User } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { basePath } from '@/App';

export function SignInPage() {
  const { t, dir } = useI18n();
  const clerk = useClerk();
  const [, setLocation] = useLocation();
  const login = usePasswordLogin();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    login.mutate(
      { data: { identifier, password } },
      {
        onSuccess: async (res) => {
          try {
            const signInAttempt = await clerk.client.signIn.create({
              strategy: 'ticket',
              ticket: res.ticket,
            });
            if (signInAttempt.status === 'complete') {
              await clerk.setActive({ session: signInAttempt.createdSessionId });
              setLocation('/');
            } else {
              setError(t('auth.unauthorized'));
            }
          } catch (err: unknown) {
            console.error('Clerk ticket error', err);
            const message = err instanceof Error ? err.message : (err as { errors?: { message?: string }[] })?.errors?.[0]?.message;
            setError(message || t('error.title'));
          }
        },
        onError: () => {
          setError(t('auth.invalidCredentials'));
        }
      }
    );
  };

  return (
    <div dir={dir} className="grid min-h-[100dvh] place-items-center bg-ec-pattern px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-background/90 backdrop-blur-3xl" />
      
      <div className={`absolute top-4 z-10 sm:top-8 ${dir === 'rtl' ? 'right-5 sm:right-8' : 'left-5 sm:left-8'}`}>
        <Link href="/" data-testid="link-auth-logo" className="block hover:opacity-80 transition-opacity">
          <img src={`${basePath}/ec-official-logo-v2.png`} alt={t('admin.brand')} className="mx-auto h-20 w-24 object-contain drop-shadow-sm sm:h-28 sm:w-36" />
        </Link>
      </div>
      <div className={`absolute top-8 z-10 ${dir === 'rtl' ? 'left-8' : 'right-8'}`}>
        <LanguageSwitcher className="bg-card/95 shadow-sm backdrop-blur" />
      </div>
      
      <div className="relative z-10 w-full max-w-md animate-rise">
        <div className="rounded-[2rem] border border-border bg-card p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-foreground">{t('auth.signIn')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('auth.welcome')}</p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <label className="block text-sm font-bold text-foreground">
              {t('auth.identifier')}
              <div className="relative mt-2">
                <User className={`absolute top-3 text-muted-foreground ${dir === 'rtl' ? 'right-3' : 'left-3'}`} size={18} />
                <input
                  data-testid="input-signin-identifier"
                  type="text"
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={t('auth.identifierPlaceholder')}
                  className={`w-full rounded-xl border border-input bg-background py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                />
              </div>
            </label>

            <label className="block text-sm font-bold text-foreground">
              <div className="flex items-center justify-between">
                <span>{t('auth.password')}</span>
                <Link href="/forgot-password" data-testid="link-forgot-password" className="text-xs font-semibold text-primary hover:underline">
                  {t('passwordReset.forgot')}
                </Link>
              </div>
              <div className="relative mt-2">
                <LockKeyhole className={`absolute top-3 text-muted-foreground ${dir === 'rtl' ? 'right-3' : 'left-3'}`} size={18} />
                <input
                  data-testid="input-signin-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full rounded-xl border border-input bg-background py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                />
              </div>
            </label>

            {error && (
              <p className="rounded-xl bg-destructive/10 p-3 text-sm font-bold text-destructive">
                {error}
              </p>
            )}

            <Button
              data-testid="button-signin-submit"
              type="submit"
              className="mt-2 w-full text-base"
              disabled={login.isPending || !identifier || !password}
            >
              {login.isPending ? t('common.loading') : t('auth.signIn')}
            </Button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-4 border-t border-border pt-6">
            <p className="text-sm font-medium text-muted-foreground">
              {t('landing.registrationMessage')}{' '}
              <Link href="/register" data-testid="link-register" className="font-bold text-primary hover:underline">
                {t('auth.signUp')}
              </Link>
            </p>
            <Link href="/owner-recovery" data-testid="link-owner-recovery" className="text-[11px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors">
              {t('phoneAuth.ownerRecovery')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
