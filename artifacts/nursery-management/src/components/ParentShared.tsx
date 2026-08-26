import React from 'react';

export function ParentPageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#0f2416] sm:text-4xl">{title}</h1>
        {description && <p className="mt-3 text-base text-[#165032]/70 max-w-lg leading-relaxed">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function ParentQueryState({ 
  loading, error, empty, emptyMessage = "لا توجد بيانات بعد", children, onRetry 
}: { 
  loading?: boolean; error?: boolean; empty?: boolean; emptyMessage?: string; children: React.ReactNode; onRetry?: () => void 
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse rounded-2xl bg-[#165032]/5 h-24 w-full" />
        <div className="animate-pulse rounded-2xl bg-[#165032]/5 h-24 w-full" />
        <div className="animate-pulse rounded-2xl bg-[#165032]/5 h-24 w-full" />
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[2rem] border border-dashed border-red-200 bg-red-50 p-12 text-center">
        <p className="font-bold text-red-700 text-lg">تعذر تحميل البيانات</p>
        <p className="mt-2 text-sm text-red-600/70">الرجاء التحقق من الاتصال والمحاولة مرة أخرى.</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-5 rounded-xl bg-red-100 px-6 py-2.5 text-sm font-bold text-red-700 hover:bg-red-200 transition-colors">
            إعادة المحاولة
          </button>
        )}
      </div>
    );
  }
  
  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[2rem] border border-dashed border-[#165032]/10 bg-white p-14 text-center">
        <div className="mb-5 h-16 w-16 rounded-full bg-[#FDFBF7] flex items-center justify-center border border-[#165032]/5">
          <span className="text-2xl opacity-50">✨</span>
        </div>
        <p className="font-bold text-[#0f2416] text-lg">{emptyMessage}</p>
        <p className="mt-2 text-sm text-[#165032]/50">ستظهر السجلات هنا فور توفرها من إدارة الحضانة.</p>
      </div>
    );
  }
  
  return <>{children}</>;
}
