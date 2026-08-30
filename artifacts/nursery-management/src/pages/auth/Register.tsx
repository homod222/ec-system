import { useState } from 'react';
import { Link } from 'wouter';
import { useRequestGuardianRegistration, useCompleteGuardianRegistration, useRequestStaffRegistration } from '@workspace/api-client-react';
import { useI18n } from '@/i18n';
import { Button } from '@/App';
import { User, Mail, Phone, LockKeyhole, ShieldCheck, CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { basePath } from '@/App';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

type Step = 'select' | 'guardian-form' | 'guardian-otp' | 'guardian-success' | 'staff-form' | 'staff-success';

export function RegisterPage() {
  const { t, dir } = useI18n();
  const [step, setStep] = useState<Step>('select');
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [resultStatus, setResultStatus] = useState<string>('');

  const reqGuardian = useRequestGuardianRegistration();
  const compGuardian = useCompleteGuardianRegistration();
  const reqStaff = useRequestStaffRegistration();

  const handleGuardianRequest = (e: React.FormEvent) => {
    e.preventDefault();
    reqGuardian.mutate(
      { data: form },
      {
        onSuccess: (res) => {
          setChallengeId(res.challengeId);
          setStep('guardian-otp');
        }
      }
    );
  };

  const handleGuardianComplete = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== passwordConfirm || password.length < 8) return;
    compGuardian.mutate(
      { data: { challengeId, otp, password } },
      {
        onSuccess: (res) => {
          setResultStatus(res.status);
          setStep('guardian-success');
        }
      }
    );
  };

  const handleStaffRequest = (e: React.FormEvent) => {
    e.preventDefault();
    reqStaff.mutate(
      { data: form },
      {
        onSuccess: () => {
          setStep('staff-success');
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
          
          {step === 'select' && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-foreground">{t('auth.signUp')}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{t('landing.registrationMessage')}</p>
              </div>

              <div className="space-y-4">
                <button
                  data-testid="button-select-guardian"
                  onClick={() => setStep('guardian-form')}
                  className="flex w-full items-center justify-between rounded-2xl border-2 border-transparent bg-muted/50 p-5 hover:border-primary/20 hover:bg-primary/5 transition-all text-start"
                >
                  <div>
                    <p className="font-bold text-foreground">{t('expanded.guardian')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('parent.portal')}</p>
                  </div>
                  {dir === 'rtl' ? <ChevronLeft className="text-muted-foreground" /> : <ChevronRight className="text-muted-foreground" />}
                </button>

                <button
                  data-testid="button-select-staff"
                  onClick={() => setStep('staff-form')}
                  className="flex w-full items-center justify-between rounded-2xl border-2 border-transparent bg-muted/50 p-5 hover:border-primary/20 hover:bg-primary/5 transition-all text-start"
                >
                  <div>
                    <p className="font-bold text-foreground">{t('expanded.employee')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('staffAccounts.description')}</p>
                  </div>
                  {dir === 'rtl' ? <ChevronLeft className="text-muted-foreground" /> : <ChevronRight className="text-muted-foreground" />}
                </button>
              </div>

              <div className="text-center mt-6">
                <Link href="/sign-in" className="text-sm font-bold text-primary hover:underline">
                  {t('auth.signIn')}
                </Link>
              </div>
            </div>
          )}

          {(step === 'guardian-form' || step === 'staff-form') && (
            <form onSubmit={step === 'guardian-form' ? handleGuardianRequest : handleStaffRequest} className="space-y-5">
              <div className="mb-8 flex items-center gap-3">
                <button type="button" onClick={() => setStep('select')} className="rounded-xl bg-muted p-2 hover:bg-secondary">
                  {dir === 'rtl' ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
                <h1 className="text-xl font-bold text-foreground">
                  {step === 'guardian-form' ? t('expanded.guardian') : t('expanded.employee')}
                </h1>
              </div>

              <label className="block text-sm font-bold text-foreground">
                {t('expanded.name')}
                <div className="relative mt-2">
                  <User className={`absolute top-3 text-muted-foreground ${dir === 'rtl' ? 'right-3' : 'left-3'}`} size={18} />
                  <input
                    data-testid="input-register-name"
                    required
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={`w-full rounded-xl border border-input bg-background py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                  />
                </div>
              </label>

              <label className="block text-sm font-bold text-foreground">
                {t('expanded.email')}
                <div className="relative mt-2">
                  <Mail className={`absolute top-3 text-muted-foreground ${dir === 'rtl' ? 'right-3' : 'left-3'}`} size={18} />
                  <input
                    data-testid="input-register-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className={`w-full rounded-xl border border-input bg-background py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                  />
                </div>
              </label>

              <label className="block text-sm font-bold text-foreground">
                {t('phoneAuth.phone')}
                <div className="relative mt-2">
                  <Phone className={`absolute top-3 text-muted-foreground ${dir === 'rtl' ? 'right-3' : 'left-3'}`} size={18} />
                  <input
                    data-testid="input-register-phone"
                    type="tel"
                    required
                    autoComplete="tel"
                    placeholder="965..."
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className={`w-full rounded-xl border border-input bg-background py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4'}`}
                  />
                </div>
              </label>

              {(reqGuardian.isError || reqStaff.isError) && (
                <p className="rounded-xl bg-destructive/10 p-3 text-sm font-bold text-destructive">
                  {t('error.title')}
                </p>
              )}

              <Button
                data-testid="button-register-request"
                type="submit"
                className="w-full"
                disabled={reqGuardian.isPending || reqStaff.isPending || !form.name || !form.email || !form.phone}
              >
                {reqGuardian.isPending || reqStaff.isPending ? t('common.loading') : t('common.save')}
              </Button>
            </form>
          )}

          {step === 'guardian-otp' && (
            <form onSubmit={handleGuardianComplete} className="space-y-5">
              <div className="text-center mb-6">
                <ShieldCheck className="mx-auto text-primary mb-3" size={32} />
                <h1 className="text-xl font-bold text-foreground">{t('staffActivation.otp')}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{t('phoneAuth.namedGreeting', { name: form.name })}</p>
              </div>

              <div className="flex justify-center">
                <InputOTP data-testid="input-register-otp" maxLength={6} value={otp} onChange={setOtp} containerClassName="justify-center">
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
                    data-testid="input-register-password"
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
                    data-testid="input-register-password-confirm"
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

              {compGuardian.isError && (
                <p className="rounded-xl bg-destructive/10 p-3 text-sm font-bold text-destructive">
                  {t('phoneAuth.verifyError')}
                </p>
              )}

              <Button
                data-testid="button-register-complete"
                type="submit"
                className="w-full"
                disabled={compGuardian.isPending || otp.length !== 6 || password.length < 8 || password !== passwordConfirm}
              >
                {compGuardian.isPending ? t('common.loading') : t('staffActivation.create')}
              </Button>
            </form>
          )}

          {step === 'guardian-success' && (
            <div className="text-center space-y-5">
              <CheckCircle2 className="mx-auto text-emerald-600" size={48} />
              <h1 className="text-2xl font-bold text-foreground">
                {resultStatus === 'needs_admin' ? t('auth.pendingTitle') : t('staffActivation.successTitle')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {resultStatus === 'needs_admin' ? t('auth.pendingBody') : t('staffActivation.successBody')}
              </p>
              <Link href="/sign-in">
                <Button className="w-full">{t('auth.signIn')}</Button>
              </Link>
            </div>
          )}

          {step === 'staff-success' && (
            <div className="text-center space-y-5">
              <CheckCircle2 className="mx-auto text-emerald-600" size={48} />
              <h1 className="text-2xl font-bold text-foreground">{t('auth.pendingTitle')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('auth.pendingBody')}
              </p>
              <Link href="/sign-in">
                <Button className="w-full">{t('common.close')}</Button>
              </Link>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
