import { Shell, PageHeader } from '../../App';
import { Settings as SettingsIcon, Bell, Calendar, Store, CreditCard } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';

export function Settings() {
  return (
    <Shell>
      <PageHeader 
        eyebrow="تكوين النظام" 
        title="الإعدادات العامة" 
        description="إدارة فروع الحضانة، أوقات العمل، العطلات، والإشعارات." 
      />
      
      <OperationalManager resource="branch" title="الفروع والمباني" icon={Store} extraFields={[{name: 'address', label: 'العنوان', type: 'text'}, {name: 'phone', label: 'رقم التواصل', type: 'tel'}]} />
      <OperationalManager resource="stage" title="المراحل العمرية" icon={SettingsIcon} />
      <OperationalManager resource="holiday" title="العطلات الرسمية" icon={Calendar} />
      <OperationalManager resource="notification" title="قوالب الإشعارات" icon={Bell} extraFields={[{name: 'template', label: 'نص القالب', type: 'text'}]} />
      <OperationalManager resource="integration" title="بوابات الدفع والتكامل" icon={CreditCard} extraFields={[{name: 'provider', label: 'مزود الخدمة', type: 'text'}]} />
      <OperationalManager resource="setting" title="متغيرات النظام الأساسية" icon={SettingsIcon} extraFields={[{name: 'value', label: 'القيمة', type: 'text'}]} />
    </Shell>
  );
}
