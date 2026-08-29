import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetNurserySettingsQueryKey, useGetNurserySettings, useSetNurserySettings } from '@workspace/api-client-react';
import { Shell, PageHeader, Button, QueryState } from '../../App';
import { Settings as SettingsIcon, Bell, Calendar, Store, CreditCard, Plus, Trash2 } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';
import { useI18n } from '../../i18n';

const DAYS = [
  { key: 'sunday', labelKey: 'settings.sunday' },
  { key: 'monday', labelKey: 'settings.monday' },
  { key: 'tuesday', labelKey: 'settings.tuesday' },
  { key: 'wednesday', labelKey: 'settings.wednesday' },
  { key: 'thursday', labelKey: 'settings.thursday' },
  { key: 'friday', labelKey: 'settings.friday' },
  { key: 'saturday', labelKey: 'settings.saturday' },
] as const;

type DayKey = typeof DAYS[number]['key'];
type DayHours = { enabled: boolean; open: string; close: string };
type HoursForm = Record<DayKey, DayHours>;
type JsonRecord = Record<string, unknown>;

const defaultHours = (): HoursForm => Object.fromEntries(
  DAYS.map(({ key }) => [key, { enabled: !['friday', 'saturday'].includes(key), open: '07:00', close: '14:00' }]),
) as HoursForm;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function settingsToHours(workingHours: unknown, calendar: unknown): HoursForm {
  const hours = isRecord(workingHours) ? workingHours : {};
  const calendarRecord = isRecord(calendar) ? calendar : {};
  const weekend = Array.isArray(calendarRecord.weekend) ? calendarRecord.weekend : [];
  return Object.fromEntries(DAYS.map(({ key }) => {
    const value = isRecord(hours[key]) ? hours[key] : {};
    const enabled = !weekend.includes(key) && typeof value.open === 'string' && typeof value.close === 'string';
    return [key, {
      enabled,
      open: typeof value.open === 'string' ? value.open : '07:00',
      close: typeof value.close === 'string' ? value.close : '14:00',
    }];
  })) as HoursForm;
}

export function Settings({ withShell = true }: { withShell?: boolean } = {}) {
  const { t, formatDate } = useI18n();
  const query = useGetNurserySettings();
  const save = useSetNurserySettings();
  const qc = useQueryClient();
  const [nurseryName, setNurseryName] = useState('');
  const [registrationWhatsApp, setRegistrationWhatsApp] = useState('96590916677');
  const [timezone, setTimezone] = useState('Asia/Kuwait');
  const [hours, setHours] = useState<HoursForm>(defaultHours);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayInputError, setHolidayInputError] = useState('');
  const [originalWorkingHours, setOriginalWorkingHours] = useState<JsonRecord>({});
  const [originalCalendar, setOriginalCalendar] = useState<JsonRecord>({});
  const [submitted, setSubmitted] = useState(false);
  const [loginPhone, setLoginPhone] = useState('');
  const [loginChallenge, setLoginChallenge] = useState('');
  const [loginOtp, setLoginOtp] = useState('');
  const [loginPhoneStatus, setLoginPhoneStatus] = useState('');
  const [loginPhoneBusy, setLoginPhoneBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/phone/enrollment').then(response => response.ok ? response.json() : null)
      .then(data => { if (data?.phone) { setLoginPhone(data.phone); setLoginPhoneStatus(t('settings.loginPhoneVerified')); } })
      .catch(() => undefined);
  }, [t]);

  const requestLoginPhone = async () => {
    setLoginPhoneBusy(true); setLoginPhoneStatus('');
    try {
      const response = await fetch('/api/auth/phone/enrollment/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: loginPhone }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setLoginChallenge(data.challengeId);
      setLoginPhoneStatus(t('settings.loginPhoneCodeSent'));
    } catch { setLoginPhoneStatus(t('settings.loginPhoneError')); }
    finally { setLoginPhoneBusy(false); }
  };

  const verifyLoginPhone = async () => {
    setLoginPhoneBusy(true); setLoginPhoneStatus('');
    try {
      const response = await fetch('/api/auth/phone/enrollment/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: loginChallenge, otp: loginOtp }),
      });
      if (!response.ok) throw new Error();
      setLoginChallenge(''); setLoginOtp('');
      setLoginPhoneStatus(t('settings.loginPhoneVerified'));
    } catch { setLoginPhoneStatus(t('settings.loginPhoneError')); }
    finally { setLoginPhoneBusy(false); }
  };

  useEffect(() => {
    if (!query.data) return;
    const workingHours = isRecord(query.data.workingHours) ? query.data.workingHours : {};
    const calendar = isRecord(query.data.calendar) ? query.data.calendar : {};
    setNurseryName(query.data.nurseryName);
    setRegistrationWhatsApp(query.data.registrationWhatsApp ?? '96590916677');
    setTimezone(query.data.timezone);
    setHours(settingsToHours(workingHours, calendar));
    setHolidays(Array.isArray(calendar.holidays) ? calendar.holidays.filter((date): date is string => typeof date === 'string').sort() : []);
    setOriginalWorkingHours(workingHours);
    setOriginalCalendar(calendar);
  }, [query.data]);

  const errors = useMemo(() => {
    const next: string[] = [];
    const whatsappDigits = registrationWhatsApp.replace(/\D/g, '');
    if (!/^(?:965)?[569]\d{7}$/.test(whatsappDigits)) next.push(t('settings.registrationWhatsAppInvalid'));
    DAYS.forEach(({ key, labelKey }) => {
      const label = t(labelKey);
      const day = hours[key];
      if (day.enabled && (!day.open || !day.close)) next.push(t('settings.openCloseRequired', { day: label }));
      if (day.enabled && day.open >= day.close) next.push(t('settings.openBeforeClose', { day: label }));
    });
    if (new Set(holidays).size !== holidays.length) next.push(t('settings.duplicateDate'));
    if (holidays.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
      next.push(t('settings.invalidHoliday'));
    }
    return next;
  }, [hours, holidays, registrationWhatsApp, t]);

  const updateDay = (key: DayKey, patch: Partial<DayHours>) => {
    setHours(current => ({ ...current, [key]: { ...current[key], ...patch } }));
    setSubmitted(false);
  };

  const addHoliday = () => {
    if (!holidayDate) return;
    if (holidays.includes(holidayDate)) {
      setHolidayInputError(t('settings.duplicateHoliday'));
      return;
    }
    setHolidays(current => [...current, holidayDate].sort());
    setHolidayDate('');
    setHolidayInputError('');
    setSubmitted(false);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.length) return;

    const workingHours: JsonRecord = { ...originalWorkingHours };
    DAYS.forEach(({ key }) => {
      if (hours[key].enabled) workingHours[key] = { open: hours[key].open, close: hours[key].close };
      else delete workingHours[key];
    });
    const weekend = DAYS.filter(({ key }) => !hours[key].enabled).map(({ key }) => key);
    const calendar = { ...originalCalendar, weekend, holidays };

    save.mutate(
      { data: { nurseryName, registrationWhatsApp, timezone, currency: 'KWD', workingHours, calendar } },
      {
        onSuccess: () => {
          setSubmitted(false);
          qc.invalidateQueries({ queryKey: getGetNurserySettingsQueryKey() });
        },
      },
    );
  };

  const content = (
    <>
      <PageHeader
        eyebrow={t('settings.eyebrow')} title={t('settings.title')} description={t('settings.description')}
      />

      <QueryState loading={query.isLoading} error={query.isError} empty={!query.data} onRetry={() => query.refetch()}>
        <section className="mb-8 rounded-[2rem] border border-border bg-card p-5 shadow-sm md:p-7">
          <h2 className="text-xl font-bold">{t('settings.loginPhone')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('settings.loginPhoneHelp')}</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row" dir="ltr">
            <input data-testid="input-owner-login-phone" type="tel" value={loginPhone}
              onChange={event => setLoginPhone(event.target.value)}
              className="min-h-11 flex-1 rounded-xl border border-input bg-background px-4" placeholder="+965 5••• ••••" />
            <Button data-testid="button-request-owner-login-phone" type="button" onClick={requestLoginPhone} disabled={loginPhoneBusy}>
              {t('settings.loginPhoneSend')}
            </Button>
          </div>
          {loginChallenge && <div className="mt-3 flex flex-col gap-3 sm:flex-row" dir="ltr">
            <input data-testid="input-owner-login-otp" inputMode="numeric" maxLength={6} value={loginOtp}
              onChange={event => setLoginOtp(event.target.value.replace(/\D/g, ''))}
              className="min-h-11 flex-1 rounded-xl border border-input bg-background px-4 text-center font-mono tracking-[.4em]" />
            <Button data-testid="button-verify-owner-login-phone" type="button" onClick={verifyLoginPhone} disabled={loginPhoneBusy || loginOtp.length !== 6}>
              {t('settings.loginPhoneVerify')}
            </Button>
          </div>}
          {loginPhoneStatus && <p className="mt-3 text-sm font-bold text-primary">{loginPhoneStatus}</p>}
        </section>
        <form onSubmit={submit} className="mb-8 rounded-[2rem] border border-border bg-card p-5 shadow-sm md:p-7">
          <h2 className="text-xl font-bold">{t('settings.details')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('settings.detailsHelp')}</p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">{t('settings.nurseryName')}
              <input required value={nurseryName} onChange={event => setNurseryName(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" />
            </label>
            <label className="text-sm font-bold">{t('settings.timezone')}
              <input required value={timezone} onChange={event => setTimezone(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" />
            </label>
            <label className="text-sm font-bold">{t('settings.registrationWhatsApp')}
              <input
                required
                type="tel"
                inputMode="tel"
                dir="ltr"
                value={registrationWhatsApp}
                onChange={event => { setRegistrationWhatsApp(event.target.value); setSubmitted(false); }}
                placeholder="96590916677"
                className={`mt-2 w-full rounded-xl border bg-background px-4 py-3 text-left ${submitted && !/^(?:965)?[569]\d{7}$/.test(registrationWhatsApp.replace(/\D/g, '')) ? 'border-destructive' : 'border-input'}`}
              />
              <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('settings.registrationWhatsAppHelp')}</span>
            </label>
          </div>

          <section className="mt-7">
            <div className="mb-3">
               <h3 className="font-bold">{t('settings.hours')}</h3>
               <p className="text-sm text-muted-foreground">{t('settings.hoursHelp')}</p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border">
               {DAYS.map(({ key, labelKey }, index) => {
                 const label = t(labelKey);
                const day = hours[key];
                const invalid = submitted && day.enabled && (!day.open || !day.close || day.open >= day.close);
                return (
                  <div key={key} className={`grid items-center gap-3 p-4 md:grid-cols-[1fr_1fr_1fr] ${index ? 'border-t border-border' : ''} ${day.enabled ? 'bg-card' : 'bg-muted/40'}`}>
                    <label className="flex cursor-pointer items-center gap-3 font-bold">
                      <input type="checkbox" checked={day.enabled} onChange={event => updateDay(key, { enabled: event.target.checked })} className="h-5 w-5 accent-primary" />
                      <span>{label}</span>
                       <span className={`rounded-full px-2 py-1 text-xs ${day.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{day.enabled ? t('settings.workday') : t('settings.dayOff')}</span>
                    </label>
                     <label className="text-xs font-bold text-muted-foreground">{t('settings.open')}
                       <input aria-label={`${t('settings.open')} ${label}`} type="time" value={day.open} disabled={!day.enabled} onChange={event => updateDay(key, { open: event.target.value })} className={`mt-1 w-full rounded-xl border bg-background px-3 py-2 text-base disabled:cursor-not-allowed disabled:opacity-50 ${invalid ? 'border-destructive' : 'border-input'}`} />
                    </label>
                     <label className="text-xs font-bold text-muted-foreground">{t('settings.closeTime')}
                       <input aria-label={`${t('settings.closeTime')} ${label}`} type="time" value={day.close} disabled={!day.enabled} onChange={event => updateDay(key, { close: event.target.value })} className={`mt-1 w-full rounded-xl border bg-background px-3 py-2 text-base disabled:cursor-not-allowed disabled:opacity-50 ${invalid ? 'border-destructive' : 'border-input'}`} />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-7">
             <h3 className="font-bold">{t('settings.holidays')}</h3>
             <p className="text-sm text-muted-foreground">{t('settings.holidaysHelp')}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
               <input aria-label={t('settings.holidayDate')} type="date" value={holidayDate} onChange={event => { setHolidayDate(event.target.value); setHolidayInputError(''); setSubmitted(false); }} className={`min-h-11 flex-1 rounded-xl border bg-background px-4 py-2 ${holidayInputError ? 'border-destructive' : 'border-input'}`} />
               <Button type="button" onClick={addHoliday} disabled={!holidayDate}><Plus className="h-4 w-4" /> {t('settings.addHoliday')}</Button>
            </div>
            {holidayInputError && <p role="alert" className="mt-2 text-sm font-bold text-destructive">{holidayInputError}</p>}
            {holidays.length ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {holidays.map(date => (
                  <li key={date} className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
                     <time dateTime={date} className="font-medium">{formatDate(date)}</time>
                     <button type="button" aria-label={t('settings.deleteHoliday', { date: formatDate(date) })} onClick={() => { setHolidays(current => current.filter(item => item !== date)); setHolidayInputError(''); }} className="rounded-lg p-2 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
             ) : <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{t('settings.noHolidays')}</p>}
          </section>

          {submitted && errors.length > 0 && (
            <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm font-bold text-destructive">
               <p>{t('settings.fixValues')}</p>
              <ul className="mt-2 list-disc space-y-1 pr-5">{errors.map(error => <li key={error}>{error}</li>)}</ul>
            </div>
          )}
           {save.isError && <p role="alert" className="mt-4 text-sm font-bold text-destructive">{t('settings.saveError')}</p>}
           {save.isSuccess && !save.isPending && <p className="mt-4 text-sm font-bold text-emerald-700">{t('settings.saveSuccess')}</p>}
           <div className="mt-5"><Button type="submit" disabled={save.isPending}>{save.isPending ? t('settings.saving') : t('settings.save')}</Button></div>
        </form>
      </QueryState>
      {withShell && (
        <>
          <OperationalManager resource="branch" title={t('settings.branches')} icon={Store} extraFields={[{name: 'address', label: t('settings.address'), type: 'text'}, {name: 'phone', label: t('settings.contactPhone'), type: 'tel'}]} />
          <OperationalManager resource="stage" title={t('settings.stages')} icon={SettingsIcon} />
          <OperationalManager resource="holiday" title={t('settings.officialHolidays')} icon={Calendar} />
          <OperationalManager resource="notification" title={t('settings.notificationTemplates')} icon={Bell} extraFields={[{name: 'template', label: t('settings.templateText'), type: 'text'}]} />
          <OperationalManager resource="integration" title={t('settings.integrations')} icon={CreditCard} extraFields={[{name: 'provider', label: t('settings.provider'), type: 'text'}]} />
          <OperationalManager resource="setting" title={t('settings.systemVariables')} icon={SettingsIcon} extraFields={[{name: 'value', label: t('settings.value'), type: 'text'}]} />
        </>
      )}
    </>
  );

  return withShell ? <Shell>{content}</Shell> : <main className="min-h-screen bg-background p-6">{content}</main>;
}
