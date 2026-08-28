import { useState } from 'react';
import { useListAuditLogs } from '@workspace/api-client-react';
import { Shell, Button, Pill, QueryState, PageHeader } from '../../App';
import { ShieldCheck, Search, Fingerprint } from 'lucide-react';
import { useI18n } from '../../i18n';

export function Audit() {
  const { t, formatDateTime } = useI18n();
  const [search, setSearch] = useState('');
  const query = useListAuditLogs();
  const logs = query.data || [];
  
  const filtered = logs.filter(l => l.operation.includes(search) || l.entityType.includes(search) || (l.actorRole && l.actorRole.includes(search)));

  return (
    <Shell>
      <PageHeader 
        eyebrow={t('audit.eyebrow')} title={t('audit.title')} description={t('audit.description')}
      />
      
      <div className="mb-6 relative max-w-md">
        <Search size={18} className="absolute end-4 top-3.5 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('audit.search')} className="w-full rounded-xl border border-border bg-card py-3.5 ps-12 pe-4 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>

      <QueryState loading={query.isLoading} error={query.isError} empty={!filtered.length} onRetry={() => query.refetch()}>
        <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[1.5fr_1fr_1.5fr_1fr] gap-4 border-b border-border bg-secondary/30 px-6 py-4 text-xs font-bold text-muted-foreground md:grid">
             <span>{t('audit.operation')}</span><span>{t('audit.role')}</span><span>{t('audit.entity')}</span><span>{t('audit.time')}</span>
          </div>
          {filtered.map((log) => (
            <div key={log.id} className="grid gap-3 border-b border-border px-6 py-4 last:border-0 hover:bg-muted/50 transition-colors md:grid-cols-[1.5fr_1fr_1.5fr_1fr] md:items-center md:gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Fingerprint size={16} /></span>
                <span className="font-bold text-foreground">{log.operation}</span>
              </div>
               <div className="text-sm font-medium text-muted-foreground">{log.actorRole || t('audit.system')}</div>
              <div className="text-sm font-medium text-foreground">{log.entityType} {log.entityId ? `#${log.entityId}` : ''}</div>
               <div className="text-xs font-medium text-muted-foreground">{formatDateTime(log.createdAt)}</div>
            </div>
          ))}
        </div>
      </QueryState>
    </Shell>
  );
}
