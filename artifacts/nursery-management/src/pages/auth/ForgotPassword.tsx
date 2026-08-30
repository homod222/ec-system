import { useState } from 'react';
import { Link } from 'wouter';
import { useRequestPasswordReset, useCompletePasswordReset } from '@workspace/api-client-react';
import { useI18n } from '@/i18n';
import { Button } from '@/App';
import { User, LockKeyhole, ShieldCheck, CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { basePath } from '@/App';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export function ForgotPasswordPage() {
  const { t, dir } = useI18n();
  const [step, setStep] = useState<'request' | 'otp' | 'success'>('request');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [challengeId, setChallengeId] = useState('');

  const requestReset = useRequestPasswordReset();
  const completeReset = useCompletePasswordReset();

  const handleRequest = (e: React.FormEvent) => {
    e.preventDefault();
    requestReset.mutate(
      { data: { identifier } },
      {
        onSuccess: (res) => {
          setChallengeId(res.challengeId);
          setStep('otp');
        }
      }
    );
  };

  const handleComplete = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== passwordConfirm || password.length < 8) return;
    completeReset.mutate(
      { data: { challengeId, otp, password } },
      {
        onSuccess: () => {
          setStep('success');
        }
      }
    );
  };

  return (
    <div dir={dir} className="grid min-h-[100dvh] place-items-center bg-ec-pattern px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-background/90 backdrop-blur-3xl" />
      
      <div className={`absolute top-4 z-10 sm:top-8 ${dir === 'rtl' ? 'right-5 sm:right-8' : 'left-5 sm:left-8'}`}>
        <Link href="/" className="block hover:opacity-80 transition-opacity">
          <img src={`${basePath}/ec-official-logo-v2.png`} alt={t('admin.brand')} className="mx-auto h-20 w-24 object-contain drop-shadow-sm sm:h-28 sm:w-36" />
        </Link>
      </div>
      <div className={`absolute top-8 z-10 ${dir === 'rtl' ? 'left-8' : 'right-8'}`}>
        <LanguageSwitcher className="bg-card/95 shadow-sm backdrop-blur" />
      </div>
      
      <div className="relative z-10 w-full max-w-md animate-rise">
        <div className="rounded-[2rem] border border-border bg-card p-8 shadow-2xl">
          
          {step === 'request' && (
            <form onSubmit={handleRequest} className="space-y-6">
              <div className="mb-8 flex items-center gap-3">
                <Link href="/sign-in" className="rounded-xl bg-muted p-2 hover:bg-secondary">
                  {dir === 'rtl' ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </Link>
                <h1 className="text-xl font-bold text-foreground">
                  {t('passwordReset.title')}
                </h1>
              </div>

              <p className="text-sm text-muted-foreground">{t('passwordReset.description')}</p>

              <label className="block text-sm font-bold text-foreground">
                {t('passwordReset.email')} / {t('phoneAuth.phone')}
                <div className="relative mt-2">
                  <User className={`absolute top-3 text-muted-foreground ${dir === 'rtl' ? 'right-3' : 'left-3'}`} size={18} />
                  <input
                    data-testid="input-forgot-identifier"
                    type="text"
                    required
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={`w-full rounded-xl border border-input bg-background py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                  />
                </div>
              </label>

              {requestReset.isError && (
                <p className="rounded-xl bg-destructive/10 p-3 text-sm font-bold text-destructive">
                  {t('phoneAuth.requestError')}
                </p>
              )}

              <Button
                data-testid="button-forgot-request"
                type="submit"
                className="w-full text-base"
                disabled={requestReset.isPending || !identifier}
              >
                {requestReset.isPending ? t('common.loading') : t('passwordReset.send')}
              </Button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleComplete} className="space-y-5">
              <div className="text-center mb-6">
                <ShieldCheck className="mx-auto text-primary mb-3" size={32} />
                <h1 className="text-xl font-bold text-foreground">{t('passwordReset.newPasswordTitle')}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{t('passwordReset.sentBody')}</p>
              </div>

              <div className="flex justify-center">
                <InputOTP data-testid="input-forgot-otp" maxLength={6} value={otp} onChange={setOtp} containerClassName="justify-center">
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot key={index} index={index} />)}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <label className="block text-sm font-bold text-foreground mt-4">
                {t('staffActivation.password')}
                <div className="relative mt-2">
                  <LockKeyhole className={`absolute top-3 text-muted-foreground ${dir === 'rtl' ? 'right-3' : 'left-3'}`} size={18} />
                  <input
                    data-testid="input-forgot-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`w-full rounded-xl border border-input bg-background py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                  />
                </div>
              </label>

              <label className="block text-sm font-bold text-foreground">
                {t('staffActivation.password')} ({t('common.verify')})
                <div className="relative mt-2">
                  <LockKeyhole className={`absolute top-3 text-muted-foreground ${dir === 'rtl' ? 'right-3' : 'left-3'}`} size={18} />
                  <input
                    data-testid="input-forgot-password-confirm"
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={8}
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className={`w-full rounded-xl border border-input bg-background py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                  />
                </div>
              </label>

              {completeReset.isError && (
                <p className="rounded-xl bg-destructive/10 p-3 text-sm font-bold text-destructive">
                  {t('passwordReset.error')}
                </p>
              )}

              <Button
                data-testid="button-forgot-complete"
                type="submit"
                className="w-full text-base"
                disabled={completeReset.isPending || otp.length !== 6 || password.length < 8 || password !== passwordConfirm}
              >
                {completeReset.isPending ? t('common.loading') : t('passwordReset.save')}
              </Button>
            </form>
          )}

          {step === 'success' && (
            <div className="text-center space-y-5">
              <CheckCircle2 className="mx-auto text-emerald-600" size={48} />
              <h1 className="text-2xl font-bold text-foreground">{t('passwordReset.completeTitle')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('passwordReset.completeBody')}
              </p>
              <Link href="/sign-in">
                <Button className="w-full">{t('auth.signIn')}</Button>
              </Link>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
