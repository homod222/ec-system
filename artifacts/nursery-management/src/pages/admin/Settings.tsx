import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetNurserySettingsQueryKey, useGetNurserySettings, useSetNurserySettings } from '@workspace/api-client-react';
import { Shell, PageHeader, Button, QueryState } from '../../App';
import { Settings as SettingsIcon, Bell, Calendar, Store, CreditCard, Plus, Trash2 } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';

const DAYS = [
  { key: 'sunday', label: 'الأحد' },
  { key: 'monday', label: 'الاثنين' },
  { key: 'tuesday', label: 'الثلاثاء' },
  { key: 'wednesday', label: 'الأربعاء' },
  { key: 'thursday', label: 'الخميس' },
  { key: 'friday', label: 'الجمعة' },
  { key: 'saturday', label: 'السبت' },
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
  const query = useGetNurserySettings();
  const save = useSetNurserySettings();
  const qc = useQueryClient();
  const [nurseryName, setNurseryName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kuwait');
  const [hours, setHours] = useState<HoursForm>(defaultHours);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayInputError, setHolidayInputError] = useState('');
  const [originalWorkingHours, setOriginalWorkingHours] = useState<JsonRecord>({});
  const [originalCalendar, setOriginalCalendar] = useState<JsonRecord>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    const workingHours = isRecord(query.data.workingHours) ? query.data.workingHours : {};
    const calendar = isRecord(query.data.calendar) ? query.data.calendar : {};
    setNurseryName(query.data.nurseryName);
    setTimezone(query.data.timezone);
    setHours(settingsToHours(workingHours, calendar));
    setHolidays(Array.isArray(calendar.holidays) ? calendar.holidays.filter((date): date is string => typeof date === 'string').sort() : []);
    setOriginalWorkingHours(workingHours);
    setOriginalCalendar(calendar);
  }, [query.data]);

  const errors = useMemo(() => {
    const next: string[] = [];
    DAYS.forEach(({ key, label }) => {
      const day = hours[key];
      if (day.enabled && (!day.open || !day.close)) next.push(`حدد وقت الفتح والإغلاق ليوم ${label}.`);
      if (day.enabled && day.open >= day.close) next.push(`يجب أن يسبق وقت الفتح وقت الإغلاق ليوم ${label}.`);
    });
    if (new Set(holidays).size !== holidays.length) next.push('يوجد تاريخ عطلة مكرر.');
    if (holidays.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) {
      next.push('يوجد تاريخ عطلة غير صالح.');
    }
    return next;
  }, [hours, holidays]);

  const updateDay = (key: DayKey, patch: Partial<DayHours>) => {
    setHours(current => ({ ...current, [key]: { ...current[key], ...patch } }));
    setSubmitted(false);
  };

  const addHoliday = () => {
    if (!holidayDate) return;
    if (holidays.includes(holidayDate)) {
      setHolidayInputError('هذا التاريخ مضاف بالفعل ضمن العطلات.');
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
      { data: { nurseryName, timezone, currency: 'KWD', workingHours, calendar } },
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
        eyebrow="تكوين النظام"
        title="الإعدادات العامة"
        description="إدارة فروع الحضانة، أوقات العمل، العطلات، والإشعارات."
      />

      <QueryState loading={query.isLoading} error={query.isError} empty={!query.data} onRetry={() => query.refetch()}>
        <form onSubmit={submit} className="mb-8 rounded-[2rem] border border-border bg-card p-5 shadow-sm md:p-7">
          <h2 className="text-xl font-bold">بيانات الحضانة وساعات العمل والتقويم</h2>
          <p className="mt-1 text-sm text-muted-foreground">اضبط أيام الدوام والعطلات من الحقول التالية دون الحاجة إلى كتابة رموز.</p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">اسم الحضانة
              <input required value={nurseryName} onChange={event => setNurseryName(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" />
            </label>
            <label className="text-sm font-bold">المنطقة الزمنية
              <input required value={timezone} onChange={event => setTimezone(event.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" />
            </label>
          </div>

          <section className="mt-7">
            <div className="mb-3">
              <h3 className="font-bold">ساعات العمل الأسبوعية</h3>
              <p className="text-sm text-muted-foreground">عطّل المفتاح لجعل اليوم إجازة أسبوعية كاملة.</p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border">
              {DAYS.map(({ key, label }, index) => {
                const day = hours[key];
                const invalid = submitted && day.enabled && (!day.open || !day.close || day.open >= day.close);
                return (
                  <div key={key} className={`grid items-center gap-3 p-4 md:grid-cols-[1fr_1fr_1fr] ${index ? 'border-t border-border' : ''} ${day.enabled ? 'bg-card' : 'bg-muted/40'}`}>
                    <label className="flex cursor-pointer items-center gap-3 font-bold">
                      <input type="checkbox" checked={day.enabled} onChange={event => updateDay(key, { enabled: event.target.checked })} className="h-5 w-5 accent-primary" />
                      <span>{label}</span>
                      <span className={`rounded-full px-2 py-1 text-xs ${day.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{day.enabled ? 'يوم عمل' : 'إجازة'}</span>
                    </label>
                    <label className="text-xs font-bold text-muted-foreground">وقت الفتح
                      <input aria-label={`وقت فتح ${label}`} type="time" value={day.open} disabled={!day.enabled} onChange={event => updateDay(key, { open: event.target.value })} className={`mt-1 w-full rounded-xl border bg-background px-3 py-2 text-base disabled:cursor-not-allowed disabled:opacity-50 ${invalid ? 'border-destructive' : 'border-input'}`} />
                    </label>
                    <label className="text-xs font-bold text-muted-foreground">وقت الإغلاق
                      <input aria-label={`وقت إغلاق ${label}`} type="time" value={day.close} disabled={!day.enabled} onChange={event => updateDay(key, { close: event.target.value })} className={`mt-1 w-full rounded-xl border bg-background px-3 py-2 text-base disabled:cursor-not-allowed disabled:opacity-50 ${invalid ? 'border-destructive' : 'border-input'}`} />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-7">
            <h3 className="font-bold">العطلات الرسمية والاستثنائية</h3>
            <p className="text-sm text-muted-foreground">اختر تاريخ العطلة ثم أضفه إلى التقويم.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input aria-label="تاريخ العطلة" type="date" value={holidayDate} onChange={event => { setHolidayDate(event.target.value); setHolidayInputError(''); setSubmitted(false); }} className={`min-h-11 flex-1 rounded-xl border bg-background px-4 py-2 ${holidayInputError ? 'border-destructive' : 'border-input'}`} />
              <Button type="button" onClick={addHoliday} disabled={!holidayDate}><Plus className="h-4 w-4" /> إضافة عطلة</Button>
            </div>
            {holidayInputError && <p role="alert" className="mt-2 text-sm font-bold text-destructive">{holidayInputError}</p>}
            {holidays.length ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {holidays.map(date => (
                  <li key={date} className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
                    <time dateTime={date} dir="ltr" className="font-medium">{date}</time>
                    <button type="button" aria-label={`حذف عطلة ${date}`} onClick={() => { setHolidays(current => current.filter(item => item !== date)); setHolidayInputError(''); }} className="rounded-lg p-2 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">لا توجد عطلات مضافة.</p>}
          </section>

          {submitted && errors.length > 0 && (
            <div role="alert" className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm font-bold text-destructive">
              <p>صحح القيم التالية قبل الحفظ:</p>
              <ul className="mt-2 list-disc space-y-1 pr-5">{errors.map(error => <li key={error}>{error}</li>)}</ul>
            </div>
          )}
          {save.isError && <p role="alert" className="mt-4 text-sm font-bold text-destructive">تعذر حفظ الإعدادات. تحقق من القيم وحاول مرة أخرى.</p>}
          {save.isSuccess && !save.isPending && <p className="mt-4 text-sm font-bold text-emerald-700">تم حفظ الإعدادات بنجاح.</p>}
          <div className="mt-5"><Button type="submit" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</Button></div>
        </form>
      </QueryState>
      {withShell && (
        <>
          <OperationalManager resource="branch" title="الفروع والمباني" icon={Store} extraFields={[{name: 'address', label: 'العنوان', type: 'text'}, {name: 'phone', label: 'رقم التواصل', type: 'tel'}]} />
          <OperationalManager resource="stage" title="المراحل العمرية" icon={SettingsIcon} />
          <OperationalManager resource="holiday" title="العطلات الرسمية" icon={Calendar} />
          <OperationalManager resource="notification" title="قوالب الإشعارات" icon={Bell} extraFields={[{name: 'template', label: 'نص القالب', type: 'text'}]} />
          <OperationalManager resource="integration" title="بوابات الدفع والتكامل" icon={CreditCard} extraFields={[{name: 'provider', label: 'مزود الخدمة', type: 'text'}]} />
          <OperationalManager resource="setting" title="متغيرات النظام الأساسية" icon={SettingsIcon} extraFields={[{name: 'value', label: 'القيمة', type: 'text'}]} />
        </>
      )}
    </>
  );

  return withShell ? <Shell>{content}</Shell> : <main dir="rtl" className="min-h-screen bg-background p-6">{content}</main>;
}
