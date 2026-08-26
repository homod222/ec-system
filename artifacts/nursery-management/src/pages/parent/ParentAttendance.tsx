import { useState, useEffect } from 'react';
import { useSearch } from 'wouter';
import { useListParentAttendance, useListParentChildren } from '@workspace/api-client-react';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { Calendar, CheckCircle2, XCircle, Clock, Info } from 'lucide-react';

export function ParentAttendance() {
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const urlChildId = searchParams.get('childId') ? Number(searchParams.get('childId')) : undefined;
  
  const [childId, setChildId] = useState<number | undefined>(urlChildId);
  
  useEffect(() => {
    setChildId(urlChildId);
  }, [search]);

  const childrenQuery = useListParentChildren();
  const attendanceQuery = useListParentAttendance(childId ? { childId } : {});
  
  const records = attendanceQuery.data || [];
  const children = childrenQuery.data || [];

  return (
    <ParentShell>
      <ParentPageHeader 
        title="سجل الحضور والانصراف" 
        description="تابعي مواعيد وصول وانصراف أبنائك بدقة لضمان سلامتهم."
      />

      <div className="mb-8 flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        <button 
          data-testid="button-filter-attendance-all"
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
            data-testid={`button-filter-attendance-${child.id}`}
            onClick={() => setChildId(child.id)}
            className={`shrink-0 rounded-2xl px-6 py-3 text-sm font-bold transition-all ${
              childId === child.id ? 'bg-[#165032] text-white shadow-md' : 'bg-white text-[#165032]/70 hover:bg-[#165032]/5 border border-[#165032]/10'
            }`}
          >
            {child.firstName}
          </button>
        ))}
      </div>

      <ParentQueryState loading={attendanceQuery.isLoading} error={attendanceQuery.isError} empty={!records.length} onRetry={() => attendanceQuery.refetch()}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {records.map(record => (
            <div key={record.id} data-testid={`card-attendance-${record.id}`} className="rounded-[2rem] bg-white p-6 shadow-sm border border-[#165032]/5 flex flex-col justify-between hover:shadow-md transition-shadow">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-bold text-[#0f2416]">{record.childName}</p>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                    record.status === 'present' ? 'bg-emerald-100 text-emerald-800' :
                    record.status === 'absent' ? 'bg-red-100 text-red-800' :
                    record.status === 'late' ? 'bg-orange-100 text-orange-800' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {record.status === 'present' ? <CheckCircle2 size={14}/> : record.status === 'absent' ? <XCircle size={14}/> : record.status === 'late' ? <Clock size={14}/> : <Info size={14}/>}
                    {record.status === 'present' ? 'حاضر' : record.status === 'absent' ? 'غائب' : record.status === 'late' ? 'متأخر' : 'بعذر'}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 text-sm text-[#165032]/70 font-medium mb-5">
                  <Calendar size={16} />
                  {new Date(record.date).toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </div>

              <div className="flex items-center gap-4 rounded-2xl bg-[#FDFBF7] p-4">
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#165032]/50 mb-1">وقت الحضور</p>
                  <p className="text-sm font-bold text-[#0f2416]" dir="ltr">{record.checkIn || '--:--'}</p>
                </div>
                <div className="h-8 w-px bg-[#165032]/10" />
                <div className="flex-1 text-right">
                  <p className="text-xs font-bold text-[#165032]/50 mb-1">وقت الانصراف</p>
                  <p className="text-sm font-bold text-[#0f2416]" dir="ltr">{record.checkOut || '--:--'}</p>
                </div>
              </div>
              
              {record.note && (
                <p className="mt-4 text-xs font-medium text-[#165032]/60 bg-blue-50/50 p-3 rounded-xl border border-blue-100/50">
                  <span className="font-bold text-blue-700 block mb-0.5">ملاحظة:</span>
                  {record.note}
                </p>
              )}
            </div>
          ))}
        </div>
      </ParentQueryState>
    </ParentShell>
  );
}
