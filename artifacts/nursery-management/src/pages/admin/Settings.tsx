import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetNurserySettingsQueryKey, useGetNurserySettings, useSetNurserySettings } from '@workspace/api-client-react';
import { Shell, PageHeader, Button, QueryState } from '../../App';
import { Settings as SettingsIcon, Bell, Calendar, Store, CreditCard } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';

export function Settings() {
  const query = useGetNurserySettings();
  const save = useSetNurserySettings();
  const qc = useQueryClient();
  const [form, setForm] = useState({ nurseryName: '', timezone: 'Asia/Kuwait', currency: 'KWD', workingHours: '{\n  \"sunday\": { \"open\": \"07:00\", \"close\": \"14:00\" }\n}', calendar: '{\n  \"weekend\": [\"friday\", \"saturday\"],\n  \"holidays\": []\n}' });
  useEffect(() => { if (query.data) setForm({ nurseryName: query.data.nurseryName, timezone: query.data.timezone, currency: query.data.currency, workingHours: JSON.stringify(query.data.workingHours, null, 2), calendar: JSON.stringify(query.data.calendar, null, 2) }); }, [query.data]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      save.mutate({ data: { nurseryName: form.nurseryName, timezone: form.timezone, currency: 'KWD', workingHours: JSON.parse(form.workingHours), calendar: JSON.parse(form.calendar) } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetNurserySettingsQueryKey() }) });
    } catch { alert('صيغة أوقات العمل أو التقويم يجب أن تكون JSON صالحاً.'); }
  };
  return (
    <Shell>
      <PageHeader 
        eyebrow="تكوين النظام" 
        title="الإعدادات العامة" 
        description="إدارة فروع الحضانة، أوقات العمل، العطلات، والإشعارات." 
      />
      
      <QueryState loading={query.isLoading} error={query.isError} empty={!query.data} onRetry={() => query.refetch()}><form onSubmit={submit} className="mb-8 rounded-[2rem] border border-border bg-card p-7 shadow-sm"><h2 className="mb-5 text-xl font-bold">بيانات الحضانة وساعات العمل والتقويم</h2><div className="grid gap-4 md:grid-cols-2"><label className="font-bold text-sm">اسم الحضانة<input required value={form.nurseryName} onChange={e => setForm({...form,nurseryName:e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" /></label><label className="font-bold text-sm">المنطقة الزمنية<input required value={form.timezone} onChange={e => setForm({...form,timezone:e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" /></label><label className="font-bold text-sm">أوقات العمل (JSON)<textarea required dir="ltr" rows={8} value={form.workingHours} onChange={e => setForm({...form,workingHours:e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 font-mono text-xs" /></label><label className="font-bold text-sm">التقويم والعطلات (JSON)<textarea required dir="ltr" rows={8} value={form.calendar} onChange={e => setForm({...form,calendar:e.target.value})} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 font-mono text-xs" /></label></div>{save.isError && <p className="mt-4 text-sm font-bold text-destructive">تعذر حفظ الإعدادات. تحقق من القيم وحاول مرة أخرى.</p>}<div className="mt-5"><Button type="submit" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</Button></div></form></QueryState>
      <OperationalManager resource="branch" title="الفروع والمباني" icon={Store} extraFields={[{name: 'address', label: 'العنوان', type: 'text'}, {name: 'phone', label: 'رقم التواصل', type: 'tel'}]} />
      <OperationalManager resource="stage" title="المراحل العمرية" icon={SettingsIcon} />
      <OperationalManager resource="holiday" title="العطلات الرسمية" icon={Calendar} />
      <OperationalManager resource="notification" title="قوالب الإشعارات" icon={Bell} extraFields={[{name: 'template', label: 'نص القالب', type: 'text'}]} />
      <OperationalManager resource="integration" title="بوابات الدفع والتكامل" icon={CreditCard} extraFields={[{name: 'provider', label: 'مزود الخدمة', type: 'text'}]} />
      <OperationalManager resource="setting" title="متغيرات النظام الأساسية" icon={SettingsIcon} extraFields={[{name: 'value', label: 'القيمة', type: 'text'}]} />
    </Shell>
  );
}
