import { Shell, PageHeader } from '../../App';
import { Sparkles, BookOpen, Presentation, Bookmark } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';

export function Education() {
  return (
    <Shell>
      <PageHeader 
        eyebrow="النظام الأكاديمي" 
        title="التعليم والمناهج" 
        description="إدارة الخطط الدراسية، المهارات، والتقييمات الأكاديمية للأطفال." 
      />
      
      <OperationalManager resource="curriculum" title="المناهج الدراسية" icon={BookOpen} />
      <OperationalManager resource="lesson-plan" title="الخطط الأسبوعية" icon={Presentation} extraFields={[{name: 'week', label: 'الأسبوع', type: 'text'}]} />
      <OperationalManager resource="skill" title="المهارات المكتسبة" icon={Sparkles} extraFields={[{name: 'category', label: 'التصنيف', type: 'text'}]} />
      <OperationalManager resource="assessment" title="التقييمات الأكاديمية" icon={Bookmark} />
      <OperationalManager resource="progress-report" title="تقارير التقدم" icon={BookOpen} />
    </Shell>
  );
}
