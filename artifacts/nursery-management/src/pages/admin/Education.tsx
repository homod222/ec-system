import { Shell, PageHeader } from '../../App';
import { Sparkles, BookOpen, Presentation, Bookmark } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';
import { useI18n } from '../../i18n';

export function Education() {
  const { t } = useI18n();
  return (
    <Shell>
      <PageHeader 
        eyebrow={t('expanded.academicSystem')}
        title={t('expanded.educationTitle')}
        description={t('expanded.educationDesc')}
      />
      
      <OperationalManager resource="curriculum" title={t('expanded.curricula')} icon={BookOpen} />
      <OperationalManager resource="lesson-plan" title={t('expanded.weeklyPlans')} icon={Presentation} extraFields={[{name: 'week', label: t('expanded.week'), type: 'text'}]} />
      <OperationalManager resource="skill" title={t('expanded.skills')} icon={Sparkles} extraFields={[{name: 'category', label: t('expanded.classification'), type: 'text'}]} />
      <OperationalManager resource="assessment" title={t('expanded.assessments')} icon={Bookmark} />
      <OperationalManager resource="progress-report" title={t('expanded.progressReports')} icon={BookOpen} />
    </Shell>
  );
}
