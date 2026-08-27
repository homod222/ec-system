import { useState } from 'react';
import { useGetNurseryReport, useListClassrooms, useListOperationalRecords } from '@workspace/api-client-react';
import { Shell, Button, QueryState, PageHeader, money } from '../../App';
import { Download } from 'lucide-react';

export function Reports() {
  const [domain, setDomain] = useState<'operational' | 'academic' | 'financial'>('financial');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [classroomId, setClassroomId] = useState('');
  
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

  return (
    <Shell>
      <PageHeader 
        eyebrow="تحليل البيانات" 
        title="تقارير الحضانة" 
        description="إحصاءات وتقارير شاملة حول الأداء الأكاديمي، المالي، والتشغيلي." 
        action={<Button data-testid="button-print-report" variant="soft" onClick={() => window.print()}><Download size={18} />طباعة / حفظ PDF</Button>}
      />
      
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-card p-4 rounded-2xl border border-border">
        <div className="flex flex-wrap gap-2">
          <Button data-testid="button-report-financial" variant={domain === 'financial' ? 'primary' : 'ghost'} onClick={() => setDomain('financial')} className="!px-3 !py-1.5 !text-xs">المالية</Button>
          <Button data-testid="button-report-academic" variant={domain === 'academic' ? 'primary' : 'ghost'} onClick={() => setDomain('academic')} className="!px-3 !py-1.5 !text-xs">الأكاديمية</Button>
          <Button data-testid="button-report-operational" variant={domain === 'operational' ? 'primary' : 'ghost'} onClick={() => setDomain('operational')} className="!px-3 !py-1.5 !text-xs">التشغيل</Button>
        </div>
        
        <div className="flex flex-wrap gap-3 items-center">
          <select data-testid="filter-report-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-bold outline-none">
            <option value="">جميع الفروع</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
          <select data-testid="filter-report-classroom" value={classroomId} onChange={(e) => setClassroomId(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-bold outline-none">
            <option value="">جميع الفصول</option>
            {classrooms.map(classroom => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">من:</span>
            <input data-testid="filter-report-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-bold outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">إلى:</span>
            <input data-testid="filter-report-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-1.5 text-xs font-bold outline-none" />
          </div>
        </div>
      </div>

      <QueryState loading={query.isLoading} error={query.isError} empty={!report} onRetry={() => query.refetch()}>
        {report && (
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-[1.5rem] bg-primary p-6 text-primary-foreground shadow-sm">
                <p className="text-sm font-medium opacity-80">إجمالي السجلات</p>
                <p className="mt-2 text-3xl font-bold">{report.count}</p>
              </div>
              {domain === 'financial' && (
                <div className="rounded-[1.5rem] border border-border bg-card p-6 shadow-sm">
                  <p className="text-sm font-medium text-muted-foreground">الإجمالي المالي</p>
                  <p className="mt-2 text-3xl font-bold text-foreground">{money(report.totalAmount || 0)}</p>
                </div>
              )}
            </div>
            
            <div className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
              <h3 className="mb-6 text-xl font-bold text-foreground">الحالات</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {Object.entries(report.byStatus || {}).map(([status, count]) => (
                  <div key={status} className="rounded-xl border border-border bg-background p-4 text-center">
                    <p className="text-2xl font-bold">{count}</p>
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
