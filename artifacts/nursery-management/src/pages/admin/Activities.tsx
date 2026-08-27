import { Shell, PageHeader } from '../../App';
import { Activity as ActivityIcon, Image as ImageIcon, Calendar } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';

export function Activities() {
  return (
    <Shell>
      <PageHeader 
        eyebrow="التفاعل والمشاركة" 
        title="الأنشطة والفعاليات" 
        description="توثيق الأنشطة اليومية، الفعاليات الخاصة، ومعرض الصور." 
      />
      
      <OperationalManager resource="event" title="الفعاليات القادمة والسابقة" icon={Calendar} extraFields={[{name: 'location', label: 'الموقع', type: 'text'}]} />
      <OperationalManager resource="media" title="معرض الصور والوسائط" icon={ImageIcon} extraFields={[{name: 'album', label: 'الألبوم', type: 'text'}, {name: 'url', label: 'رابط الصورة/الفيديو', type: 'url'}]} />
    </Shell>
  );
}
