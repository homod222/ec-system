import { useListParentInvoices } from '@workspace/api-client-react';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { CreditCard, FileText, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

const money = (n: number) => new Intl.NumberFormat('ar-KW', {
  style: 'currency',
  currency: 'KWD',
  minimumFractionDigits: 0,
}).format(n || 0);

export function ParentInvoices() {
  const query = useListParentInvoices();
  const invoices = query.data || [];

  return (
    <ParentShell>
      <ParentPageHeader 
        title="الفواتير والرسوم" 
        description="سجل شفاف لجميع المدفوعات والرسوم المستحقة لضمان استمرارية الخدمات."
      />

      <ParentQueryState loading={query.isLoading} error={query.isError} empty={!invoices.length} onRetry={() => query.refetch()}>
        <div className="grid gap-5 lg:grid-cols-2">
          {invoices.map((invoice) => (
            <div key={invoice.id} data-testid={`card-invoice-${invoice.id}`} className="relative overflow-hidden rounded-[2rem] bg-white p-8 shadow-sm border border-[#165032]/5 hover:shadow-md transition-shadow">
              {/* Status Banner */}
              <div className={`absolute top-0 right-0 left-0 h-1.5 ${
                invoice.status === 'paid' ? 'bg-emerald-500' :
                invoice.status === 'overdue' ? 'bg-red-500' :
                'bg-orange-400'
              }`} />
              
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="text-xs font-bold text-[#165032]/50 mb-1">فاتورة رقم #{invoice.invoiceNumber}</p>
                  <h3 className="text-xl font-bold text-[#0f2416]">{invoice.childName}</h3>
                </div>
                
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                  invoice.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                  invoice.status === 'overdue' ? 'bg-red-100 text-red-800' :
                  'bg-orange-100 text-orange-800'
                }`}>
                  {invoice.status === 'paid' ? <CheckCircle2 size={14}/> : invoice.status === 'overdue' ? <AlertCircle size={14}/> : <Clock size={14}/>}
                  {invoice.status === 'paid' ? 'تم السداد' : invoice.status === 'overdue' ? 'متأخرة' : 'مستحقة'}
                </span>
              </div>
              
              <div className="flex items-end justify-between bg-[#FDFBF7] p-5 rounded-2xl border border-[#165032]/5 mb-6">
                <div>
                  <p className="text-xs font-bold text-[#165032]/60 mb-1">المبلغ الإجمالي</p>
                  <p className="text-3xl font-bold text-[#165032]">{money(invoice.amount)}</p>
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-[#165032]/60 mb-1">تاريخ الاستحقاق</p>
                  <p className="text-sm font-bold text-[#0f2416]" dir="ltr">{new Date(invoice.dueDate).toLocaleDateString('en-GB')}</p>
                </div>
              </div>
              
              {invoice.status !== 'paid' ? (
                <button data-testid={`button-pay-invoice-${invoice.id}`} className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#165032] py-3.5 text-sm font-bold text-white hover:-translate-y-0.5 hover:shadow-md transition-all">
                  <CreditCard size={18} /> سداد الآن
                </button>
              ) : (
                <button data-testid={`button-receipt-invoice-${invoice.id}`} className="w-full flex items-center justify-center gap-2 rounded-xl bg-white border border-[#165032]/10 py-3.5 text-sm font-bold text-[#165032] hover:bg-[#165032]/5 transition-colors">
                  <FileText size={18} /> تحميل الإيصال
                </button>
              )}
            </div>
          ))}
        </div>
      </ParentQueryState>
    </ParentShell>
  );
}
