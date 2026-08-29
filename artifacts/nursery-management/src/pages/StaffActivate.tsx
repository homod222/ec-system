import { useState } from 'react';
import { CheckCircle2, KeyRound, LockKeyhole } from 'lucide-react';
import { useVerifyStaffAccount } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Button } from '../App';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../components/ui/input-otp';
import { useI18n } from '../i18n';

export function StaffActivate() {
  const [staffId, setStaffId] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [complete, setComplete] = useState(false);
  const verify = useVerifyStaffAccount();
  const { t, dir } = useI18n();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const id = Number(staffId);
    if (!Number.isInteger(id) || id <= 0 || otp.length !== 6) return;
    verify.mutate({ id, data: { otp, password } }, { onSuccess: () => setComplete(true) });
  };

  return (
    <main dir={dir} className="grid min-h-[100dvh] place-items-center bg-gradient-to-b from-[#f5fbf7] to-[#e6f2e9] p-4">
      <div className="w-full max-w-md rounded-[2rem] border border-emerald-900/10 bg-white p-8 shadow-xl">
        {complete ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto text-emerald-700" size={48} />
            <h1 className="mt-4 text-2xl font-bold text-emerald-950">{t('staffActivation.successTitle')}</h1>
            <p className="mt-2 text-sm leading-6 text-emerald-900/70">{t('staffActivation.successBody')}</p>
            <Link href="/sign-in"><Button className="mt-6 w-full">{t('staffActivation.goToSignIn')}</Button></Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800"><KeyRound /></div>
            <h1 className="mt-5 text-2xl font-bold text-emerald-950">{t('staffActivation.title')}</h1>
            <p className="mt-2 text-sm leading-6 text-emerald-900/70">{t('staffActivation.description')}</p>

            <label className="mt-6 block text-sm font-bold text-emerald-950">{t('staffActivation.staffId')}
              <input data-testid="input-activation-staff-id" inputMode="numeric" required value={staffId} onChange={(event) => setStaffId(event.target.value.replace(/\D/g, ''))} className="mt-2 w-full rounded-xl border border-emerald-900/15 bg-white px-4 py-3 outline-none focus:border-emerald-600" />
            </label>

            <label className="mt-4 block text-sm font-bold text-emerald-950">{t('staffActivation.otp')}
              <InputOTP data-testid="input-activation-otp" maxLength={6} value={otp} onChange={setOtp} className="mt-3" containerClassName="mt-3 justify-center">
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot key={index} index={index} />)}
                </InputOTPGroup>
              </InputOTP>
            </label>

            <label className="mt-4 block text-sm font-bold text-emerald-950">{t('staffActivation.password')}
              <div className="relative mt-2">
                <LockKeyhole className="absolute right-3 top-3.5 text-emerald-800/50" size={18} />
                <input data-testid="input-activation-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-emerald-900/15 bg-white py-3 pl-4 pr-10 outline-none focus:border-emerald-600" />
              </div>
            </label>

            {verify.isError && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{t('staffActivation.error')}</p>}
            <Button data-testid="button-activate-staff" className="mt-6 w-full" disabled={verify.isPending || otp.length !== 6 || password.length < 8}>
              {verify.isPending ? t('staffActivation.creating') : t('staffActivation.create')}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}