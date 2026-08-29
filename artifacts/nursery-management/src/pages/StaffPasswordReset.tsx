import { useState } from 'react';
import { CheckCircle2, KeyRound, LockKeyhole } from 'lucide-react';
import { useCompleteStaffPasswordReset, useRequestStaffPasswordReset } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Button } from '../App';
import { useI18n } from '../i18n';

export function StaffPasswordReset() {
  const { t, dir } = useI18n();
  const params = new URLSearchParams(window.location.search);
  const staffId = Number(params.get('staffId'));
  const token = params.get('token') || '';
  const completing = Number.isInteger(staffId) && staffId > 0 && token.length >= 32;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [complete, setComplete] = useState(false);
  const requestReset = useRequestStaffPasswordReset();
  const completeReset = useCompleteStaffPasswordReset();

  return (
    <main dir={dir} className="grid min-h-[100dvh] place-items-center bg-gradient-to-b from-[#f5fbf7] to-[#e6f2e9] p-4">
      <div className="w-full max-w-md rounded-[2rem] border border-emerald-900/10 bg-white p-8 shadow-xl">
        {(sent || complete) ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto text-emerald-700" size={48} />
            <h1 className="mt-4 text-2xl font-bold text-emerald-950">
              {complete ? t('passwordReset.completeTitle') : t('passwordReset.sentTitle')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-emerald-900/70">
              {complete ? t('passwordReset.completeBody') : t('passwordReset.sentBody')}
            </p>
            <Link href="/sign-in"><Button className="mt-6 w-full">{t('staffActivation.goToSignIn')}</Button></Link>
          </div>
        ) : (
          <form onSubmit={(event) => {
            event.preventDefault();
            if (completing) {
              completeReset.mutate({ data: { staffId, token, password } }, { onSuccess: () => setComplete(true) });
            } else {
              requestReset.mutate({ data: { email } }, { onSuccess: () => setSent(true) });
            }
          }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800"><KeyRound /></div>
            <h1 className="mt-5 text-2xl font-bold text-emerald-950">
              {completing ? t('passwordReset.newPasswordTitle') : t('passwordReset.title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-emerald-900/70">
              {completing ? t('passwordReset.newPasswordBody') : t('passwordReset.description')}
            </p>
            {completing ? (
              <label className="mt-6 block text-sm font-bold text-emerald-950">{t('staffActivation.password')}
                <div className="relative mt-2">
                  <LockKeyhole className="absolute right-3 top-3.5 text-emerald-800/50" size={18} />
                  <input autoComplete="new-password" data-testid="input-reset-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-emerald-900/15 bg-white py-3 pl-4 pr-10 outline-none focus:border-emerald-600" />
                </div>
              </label>
            ) : (
              <label className="mt-6 block text-sm font-bold text-emerald-950">{t('passwordReset.email')}
                <input autoComplete="email" data-testid="input-reset-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-emerald-900/15 bg-white px-4 py-3 outline-none focus:border-emerald-600" />
              </label>
            )}
            {(requestReset.isError || completeReset.isError) && (
              <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{t('passwordReset.error')}</p>
            )}
            <Button data-testid="button-reset-password" className="mt-6 w-full" disabled={requestReset.isPending || completeReset.isPending || (completing ? password.length < 8 : !email)}>
              {completing ? t('passwordReset.save') : t('passwordReset.send')}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}