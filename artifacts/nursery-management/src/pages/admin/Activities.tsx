import { Shell, PageHeader } from '../../App';
import { Activity as ActivityIcon, Image as ImageIcon, Calendar } from 'lucide-react';
import { OperationalManager } from '../../components/OperationalManager';
import { useI18n } from '../../i18n';

export function Activities() {
  const { t } = useI18n();
  return (
    <Shell>
      <PageHeader 
        eyebrow={t('expanded.engagement')}
        title={t('expanded.activitiesTitle')}
        description={t('expanded.activitiesDesc')}
      />
      
      <OperationalManager resource="event" title={t('expanded.events')} icon={Calendar} extraFields={[{name: 'location', label: t('expanded.location'), type: 'text'}]} />
      <OperationalManager resource="media" title={t('expanded.media')} icon={ImageIcon} extraFields={[{name: 'album', label: t('expanded.album'), type: 'text'}, {name: 'url', label: t('expanded.mediaUrl'), type: 'url'}]} />
    </Shell>
  );
}
