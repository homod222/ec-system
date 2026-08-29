import { useState } from 'react';
import { exportNurseryReport, useGetNurseryReport, useListClassrooms, useListOperationalRecords } from '@workspace/api-client-react';
import { Shell, Button, QueryState, PageHeader } from '../../App';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useI18n } from '../../i18n';

export function Reports() {
  const { t, formatNumber, formatCurrency } = useI18n();
  const [domain, setDomain] = useState<'operational' | 'academic' | 'financial'>('financial');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [classroomId, setClassroomId] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const [exportError, setExportError] = useState(false);
  
  const query = useGetNurseryReport({ 
    domain,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    branchId: branchId ? Number(branchId) : undefined,
    classroomId: classroomId ? Number(classroomId) : undefined,
  });
  const report = query.data;
  
  const branchQuery = useListOperationalRecords('branch');
  const branches = branchQuery.data || [];
  const classroomQuery = useListClassrooms();
  const classrooms = classroomQuery.data || [];

  const exportReport = async (format: 'pdf' | 'xlsx') => {
    setExporting(format);
    setExportError(false);
    try {
      const blob = await exportNurseryReport({
        domain,
        format,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        branchId: branchId ? Number(branchId) : undefined,
        classroomId: classroomId ? Number(classroomId) : undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nursery-report-${domain}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(null);
    }
  };

  return (
    <Shell>
      <PageHeader 
        eyebrow={t('reports.eyebrow')} title={t('reports.title')} description={t('reports.description')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button data-testid="button-export-pdf" variant="soft" disabled={exporting !== null || !report} onClick={() => exportReport('pdf')}>
              <FileText size={18} />{exporting === 'pdf' ? t('reports.exporting') : t('reports.exportPdf')}
            </Button>
            <Button data-testid="button-export-excel" disabled={exporting !== null || !report} onClick={() => exportReport('xlsx')}>
              <FileSpreadsheet size={18} />{exporting === 'xlsx' ? t('reports.exporting') : t('reports.exportExcel')}
            </Button>
          </div>
        }
      />
      {exportError && <p role="alert" className="mb-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">{t('reports.exportError')}</p>}
      
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-card p-4 rounded-2xl border border-border">
        <div className="flex flex-wrap gap-2">
          <Button data-testid="button-report-financial" variant={domain === 'financial' ? 'primary' : 'ghost'} onClick={() => setDomain('financial')} className="!px-3 !py-1.5 !text-xs">{t('reports.financial')}</Button>
          <Button data-testid="button-report-academic" variant={domain === 'academic' ? 'primary' : 'ghost'} onClick={() => setDomain('academic')} className="!px-3 !py-1.5 !text-xs">{t('reports.academic')}</Button>
          <Button data-testid="button-report-operational" variant={domain === 'operational' ? 'primary' : 'ghost'} onClick={() => setDomain('operational')} className="!px-3 !py-1.5 !text-xs">{t('reports.operational')}</Button>
        </div>
        
        <div className="flex flex-wrap gap-3 items-center">
          <select data-testid="filter-report-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-bold outline-none">
            <option value="">{t('reports.allBranches')}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
          <select data-testid="filter-report-classroom" value={classroomId} onChange={(e) => setClassroomId(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-bold outline-none">
            <option value="">{t('reports.allClassrooms')}</option>
            {classrooms.map(classroom => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('reports.from')}</span>
            <input data-testid="filter-report-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-bold outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('reports.to')}</span>
            <input data-testid="filter-report-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-bold outline-none" />
          </div>
        </div>
      </div>

      <QueryState loading={query.isLoading} error={query.isError} empty={!report} onRetry={() => query.refetch()}>
        {report && (
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-[1.5rem] bg-primary p-6 text-primary-foreground shadow-sm">
                 <p className="text-sm font-medium opacity-80">{t('reports.totalRecords')}</p>
                 <p className="mt-2 text-3xl font-bold">{formatNumber(report.count)}</p>
              </div>
              {domain === 'financial' && (
                <div className="rounded-[1.5rem] border border-border bg-card p-6 shadow-sm">
                   <p className="text-sm font-medium text-muted-foreground">{t('reports.totalAmount')}</p>
                   <p className="mt-2 text-3xl font-bold text-foreground">{formatCurrency(report.totalAmount || 0)}</p>
                </div>
              )}
            </div>
            
            <div className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
               <h3 className="mb-6 text-xl font-bold text-foreground">{t('reports.statuses')}</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {Object.entries(report.byStatus || {}).map(([status, count]) => (
                  <div key={status} className="rounded-xl border border-border bg-background p-4 text-center">
                     <p className="text-2xl font-bold">{formatNumber(Number(count))}</p>
                    <p className="mt-1 text-sm font-medium text-muted-foreground">{status}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </Shell>
  );
}
