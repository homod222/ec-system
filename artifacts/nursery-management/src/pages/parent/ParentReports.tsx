import { useState, useEffect } from 'react';
import { useSearch } from 'wouter';
import { useListParentProgressReports, useListParentChildren } from '@workspace/api-client-react';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { FileText, GraduationCap, Download } from 'lucide-react';

export function ParentReports() {
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const urlChildId = searchParams.get('childId') ? Number(searchParams.get('childId')) : undefined;
  
  const [childId, setChildId] = useState<number | undefined>(urlChildId);
  
  useEffect(() => {
    setChildId(urlChildId);
  }, [search]);

  const childrenQuery = useListParentChildren();
  const reportsQuery = useListParentProgressReports(childId ? { childId } : {});
  
  const reports = reportsQuery.data || [];
  const children = childrenQuery.data || [];

  return (
    <ParentShell>
      <ParentPageHeader 
        title="التقارير الأكاديمية" 
        description="تابعي تطور مهارات طفلك الأكاديمية والاجتماعية من خلال تقارير دورية."
      />

      <div className="mb-8 flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        <button 
          data-testid="button-filter-reports-all"
          onClick={() => setChildId(undefined)}
          className={`shrink-0 rounded-2xl px-6 py-3 text-sm font-bold transition-all ${
            !childId ? 'bg-[#165032] text-white shadow-md' : 'bg-white text-[#165032]/70 hover:bg-[#165032]/5 border border-[#165032]/10'
          }`}
        >
          جميع الأبناء
        </button>
        {children.map(child => (
          <button 
            key={child.id}
            data-testid={`button-filter-reports-${child.id}`}
            onClick={() => setChildId(child.id)}
            className={`shrink-0 rounded-2xl px-6 py-3 text-sm font-bold transition-all ${
              childId === child.id ? 'bg-[#165032] text-white shadow-md' : 'bg-white text-[#165032]/70 hover:bg-[#165032]/5 border border-[#165032]/10'
            }`}
          >
            {child.firstName}
          </button>
        ))}
      </div>

      <ParentQueryState loading={reportsQuery.isLoading} error={reportsQuery.isError} empty={!reports.length} onRetry={() => reportsQuery.refetch()}>
        <div className="grid gap-6 md:grid-cols-2">
          {reports.map(report => (
            <div key={report.id} data-testid={`card-report-${report.id}`} className="group flex flex-col rounded-[2.5rem] bg-white p-8 shadow-sm border border-[#165032]/5 transition-all hover:shadow-lg hover:border-[#165032]/20">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <FileText size={24} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#165032]/60 mb-1">{report.childName} · {report.period}</p>
                    <h3 className="text-xl font-bold text-[#0f2416]">{report.title}</h3>
                  </div>
                </div>
              </div>
              
              <div className="flex-1">
                <p className="text-sm font-medium leading-relaxed text-[#165032]/80 bg-[#FDFBF7] p-5 rounded-2xl border border-[#165032]/5">
                  {report.summary}
                </p>
              </div>
              
              <div className="mt-6 flex items-center justify-between pt-6 border-t border-[#165032]/5">
                <div className="flex items-center gap-2 text-sm font-bold text-[#165032]/60">
                  <GraduationCap size={16} />
                  المعلمة: {report.educatorName}
                </div>
                <button data-testid={`button-download-report-${report.id}`} className="flex items-center gap-2 rounded-xl bg-[#165032]/5 px-4 py-2 text-sm font-bold text-[#165032] transition-colors hover:bg-[#165032]/10">
                  <Download size={16} /> تحميل
                </button>
              </div>
            </div>
          ))}
        </div>
      </ParentQueryState>
    </ParentShell>
  );
}
