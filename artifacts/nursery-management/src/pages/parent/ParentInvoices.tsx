import { useCreateParentInvoiceCheckoutSession, useListParentInvoices } from '@workspace/api-client-react';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { CreditCard, FileText, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { useEffect } from 'react';

const money = (n: number) => new Intl.NumberFormat('ar-KW', {
  style: 'currency',
  currency: 'KWD',
  minimumFractionDigits: 0,
}).format(n || 0);

export function ParentInvoices({ withShell = true }: { withShell?: boolean } = {}) {
  const query = useListParentInvoices();
  const checkout = useCreateParentInvoiceCheckoutSession();
  const { toast } = useToast();
  const invoices = query.data || [];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const invoiceId = params.get('invoice');
    if (!payment) return;
    if (payment === 'success') {
      toast({
        title: 'جارٍ تأكيد الدفع…',
        description: 'سيتم تحديث حالة الفاتورة بعد استلام تأكيد MyFatoorah.',
      });
      window.setTimeout(() => query.refetch(), 2500);
    } else {
      toast({
        title: 'لم تكتمل عملية الدفع',
        description: invoiceId ? `لم تُسدّد الفاتورة رقم ${invoiceId}. يمكنك المحاولة مرة أخرى.` : 'يمكنك المحاولة مرة أخرى.',
        variant: 'destructive',
      });
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const handlePay = (invoiceId: number) => {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
    const returnUrl = `${window.location.origin}${basePath}/parent/invoices`;
    checkout.mutate({ id: invoiceId, data: { returnUrl } }, {
      onSuccess: (result) => {
        window.location.href = result.url;
      },
      onError: (error) => {
        const description = error instanceof Error
          ? error.message.replace(/^HTTP \d+ [^:]*:\s*/, '')
          : 'حاول مرة أخرى أو تواصل مع إدارة الحضانة.';
        toast({ title: 'تعذّر بدء عملية الدفع', description, variant: 'destructive' });
      },
    });
  };

  const content = (
    <>
      <ParentPageHeader 
        title="الفواتير والرسوم" 
        description="سجل شفاف لجميع المدفوعات والرسوم المستحقة لضمان استمرارية الخدمات."
      />

      <section data-testid="parent-knet-summary" className="mb-6 rounded-2xl border border-[#165032]/10 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-sm font-bold text-[#0f2416]">الدفع الآمن عبر KNET</p>
          <p className="mt-1 text-sm text-[#165032]/70">سيتم خصم مبلغ الفاتورة نفسه بالدينار الكويتي عبر بوابة MyFatoorah، دون تحويل عملة.</p>
        </div>
      </section>

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
                <div>
                  <div data-testid={`text-parent-knet-amount-${invoice.id}`} className="mb-3 rounded-xl bg-[#FDFBF7] px-4 py-3 text-center text-xs leading-5 text-[#165032]/70">
                    المبلغ المطلوب عبر KNET: <strong className="text-[#165032]">{money(invoice.amount)}</strong>
                  </div>
                  <button
                    data-testid={`button-pay-invoice-${invoice.id}`}
                    onClick={() => handlePay(invoice.id)}
                    disabled={checkout.isPending}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#165032] py-3.5 text-sm font-bold text-white hover:-translate-y-0.5 hover:shadow-md transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    <CreditCard size={18} /> {checkout.isPending ? 'جارٍ التحويل…' : 'الدفع عبر KNET'}
                  </button>
                </div>
              ) : (
                <button data-testid={`button-receipt-invoice-${invoice.id}`} className="w-full flex items-center justify-center gap-2 rounded-xl bg-white border border-[#165032]/10 py-3.5 text-sm font-bold text-[#165032] hover:bg-[#165032]/5 transition-colors">
                  <FileText size={18} /> تحميل الإيصال
                </button>
              )}
            </div>
          ))}
        </div>
      </ParentQueryState>
    </>
  );

  return withShell ? <ParentShell>{content}</ParentShell> : content;
}
