import { useGetParentOverview } from '@workspace/api-client-react';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { Link } from 'wouter';
import { ChevronLeft, MessageCircle, Star, Calendar, FileText, CreditCard } from 'lucide-react';
import { useI18n } from '../../i18n';

export function ParentOverview() {
  const { t, formatCurrency, dir } = useI18n();
  const query = useGetParentOverview();
  const data = query.data;

  return (
    <ParentShell>
      <ParentPageHeader 
        title={data ? t('parent.overviewTitle', { name: data.guardianName }) : t('parent.overviewWelcome')}
        description={t('parent.overviewDesc')}
      />

      <ParentQueryState loading={query.isLoading} error={query.isError} onRetry={() => query.refetch()}>
        {data && (
          <div className="space-y-8">
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-[2rem] bg-white p-6 shadow-sm border border-[#165032]/5">
                <div className="mb-4 h-10 w-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Star size={20} />
                </div>
                <p className="text-sm font-bold text-[#165032]/60">{t('parent.enrolledChildren')}</p>
                <p data-testid="text-overview-children-count" className="mt-1 text-3xl font-bold text-[#0f2416]">{data.children.length}</p>
              </div>
              
              <div className="rounded-[2rem] bg-white p-6 shadow-sm border border-[#165032]/5">
                <div className="mb-4 h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <MessageCircle size={20} />
                </div>
                <p className="text-sm font-bold text-[#165032]/60">{t('parent.unreadMessages')}</p>
                <p data-testid="text-overview-unread-messages" className="mt-1 text-3xl font-bold text-[#0f2416]">{data.unreadMessages}</p>
              </div>

              <div className="rounded-[2rem] bg-white p-6 shadow-sm border border-[#165032]/5">
                <div className="mb-4 h-10 w-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <FileText size={20} />
                </div>
                <p className="text-sm font-bold text-[#165032]/60">{t('parent.newAnnouncements')}</p>
                <p data-testid="text-overview-announcements" className="mt-1 text-3xl font-bold text-[#0f2416]">{data.announcementsCount}</p>
              </div>

              <div className="rounded-[2rem] bg-white p-6 shadow-sm border border-[#165032]/5">
                <div className="mb-4 h-10 w-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
                  <CreditCard size={20} />
                </div>
                <p className="text-sm font-bold text-[#165032]/60">{t('parent.outstandingBalance')}</p>
                <p data-testid="text-overview-balance" className="mt-1 text-2xl font-bold text-[#0f2416]">{formatCurrency(data.outstandingBalance)}</p>
              </div>
            </div>

            {/* Children Cards */}
            <div>
              <h2 className="text-xl font-bold text-[#0f2416] mb-5">{t('parent.myChildren')}</h2>
              <div className="grid gap-6 md:grid-cols-2">
                {data.children.map((child) => (
                  <div key={child.id} data-testid={`card-child-${child.id}`} className="group relative overflow-hidden rounded-[2.5rem] bg-white p-8 shadow-sm border border-[#165032]/5 transition-all hover:shadow-lg hover:border-[#165032]/20">
                    <div className="absolute top-0 right-0 h-32 w-32 bg-gradient-to-bl from-[#165032]/5 to-transparent rounded-bl-full" />
                    
                    <div className="relative flex items-center gap-5">
                      <div className="h-20 w-20 shrink-0 rounded-full bg-[#FDFBF7] border-4 border-white shadow-md flex items-center justify-center overflow-hidden">
                        {child.avatarUrl ? (
                          <img src={child.avatarUrl} alt={child.fullName} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-2xl font-bold text-[#165032]">{child.firstName[0]}</span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-[#0f2416]">{child.firstName}</h3>
                        <p className="text-sm font-medium text-[#165032]/70 mt-1">{child.level} {child.classroomName ? `· ${child.classroomName}` : ''}</p>
                      </div>
                    </div>

                    <div className="mt-8 grid grid-cols-2 gap-3">
                      <Link href={`/parent/attendance?childId=${child.id}`} className="flex items-center gap-3 rounded-2xl bg-[#FDFBF7] p-4 hover:bg-[#165032]/5 transition-colors">
                        <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center"><Calendar size={16} /></div>
                        <div>
                          <p className="text-xs font-bold text-[#165032]/60">{t('parent.attendance')}</p>
                          <p className="text-sm font-bold text-[#0f2416]">{child.attendanceRate}%</p>
                        </div>
                      </Link>
                      <Link href={`/parent/reports?childId=${child.id}`} className="flex items-center gap-3 rounded-2xl bg-[#FDFBF7] p-4 hover:bg-[#165032]/5 transition-colors">
                        <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center"><FileText size={16} /></div>
                        <div>
                          <p className="text-xs font-bold text-[#165032]/60">{t('parent.reports')}</p>
                          <p className="text-sm font-bold text-[#0f2416]">{t('parent.view')}</p>
                        </div>
                      </Link>
                    </div>

                    <Link href={`/parent/activities?childId=${child.id}`} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#165032] py-4 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 hover:shadow-md">
                      {t('parent.diaryFor', { name: child.firstName })} <ChevronLeft size={16} className={dir === 'ltr' ? 'rotate-180' : ''} />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ParentQueryState>
    </ParentShell>
  );
}
