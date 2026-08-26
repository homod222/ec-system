import { useState, useEffect } from 'react';
import { useSearch } from 'wouter';
import { useListParentActivities, useListParentChildren } from '@workspace/api-client-react';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { ImageIcon, Clock, BookOpen, Utensils, Music, Trophy } from 'lucide-react';

export function ParentActivities() {
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const urlChildId = searchParams.get('childId') ? Number(searchParams.get('childId')) : undefined;
  
  const [childId, setChildId] = useState<number | undefined>(urlChildId);
  
  useEffect(() => {
    setChildId(urlChildId);
  }, [search]);

  const childrenQuery = useListParentChildren();
  const activitiesQuery = useListParentActivities(childId ? { childId } : {});
  
  const activities = activitiesQuery.data || [];
  const children = childrenQuery.data || [];

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'learning': return <BookOpen size={20} />;
      case 'meal': return <Utensils size={20} />;
      case 'play': return <Music size={20} />;
      case 'achievement': return <Trophy size={20} />;
      default: return <ImageIcon size={20} />;
    }
  };
  
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'learning': return 'bg-blue-50 text-blue-600';
      case 'meal': return 'bg-orange-50 text-orange-600';
      case 'play': return 'bg-pink-50 text-pink-600';
      case 'achievement': return 'bg-yellow-50 text-yellow-600';
      default: return 'bg-emerald-50 text-emerald-600';
    }
  };

  return (
    <ParentShell>
      <ParentPageHeader 
        title="يوميات الأبناء" 
        description="لحظات لا تُنسى ونشاطات يومية، تشارككم إياها المعلمات مباشرة من الحضانة."
      />

      <div className="mb-8 flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        <button 
          data-testid="button-filter-activities-all"
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
            data-testid={`button-filter-activities-${child.id}`}
            onClick={() => setChildId(child.id)}
            className={`shrink-0 rounded-2xl px-6 py-3 text-sm font-bold transition-all ${
              childId === child.id ? 'bg-[#165032] text-white shadow-md' : 'bg-white text-[#165032]/70 hover:bg-[#165032]/5 border border-[#165032]/10'
            }`}
          >
            {child.firstName}
          </button>
        ))}
      </div>

      <ParentQueryState loading={activitiesQuery.isLoading} error={activitiesQuery.isError} empty={!activities.length} onRetry={() => activitiesQuery.refetch()}>
        <div className="mx-auto max-w-2xl space-y-8">
          {activities.map((activity, index) => (
            <div key={activity.id} data-testid={`card-activity-${activity.id}`} className="relative pl-8 md:pl-0 md:pr-12 animate-rise" style={{ animationDelay: `${index * 100}ms` }}>
              {/* Timeline Line */}
              <div className="absolute top-0 bottom-[-2rem] right-4 md:right-[2.25rem] w-px bg-[#165032]/10 last:bottom-0" />
              
              {/* Timeline Dot */}
              <div className={`absolute top-6 right-0 md:right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border-4 border-[#FDFBF7] shadow-sm ${getCategoryColor(activity.category)}`}>
                {getCategoryIcon(activity.category)}
              </div>

              <div className="overflow-hidden rounded-[2rem] bg-white shadow-sm border border-[#165032]/5 hover:shadow-md transition-shadow">
                {activity.photoUrl && (
                  <div className="aspect-[4/3] w-full overflow-hidden bg-gray-100">
                    <img src={activity.photoUrl} alt={activity.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" />
                  </div>
                )}
                <div className="p-6 sm:p-8">
                  <div className="flex items-center justify-between mb-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#165032]/5 px-3 py-1 text-xs font-bold text-[#165032]">
                      <Clock size={12} /> {new Date(activity.occurredAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-xs font-bold text-[#165032]/50">{activity.childName}</span>
                  </div>
                  
                  <h3 className="text-xl font-bold text-[#0f2416] mb-2">{activity.title}</h3>
                  <p className="text-sm font-medium leading-relaxed text-[#165032]/70 mb-5">{activity.description}</p>
                  
                  <div className="flex items-center gap-3 pt-5 border-t border-[#165032]/5 text-xs font-bold text-[#165032]/50">
                    <div className="h-6 w-6 rounded-full bg-[#FDFBF7] border border-[#165032]/10 flex items-center justify-center text-[#165032]">
                      {activity.educatorName[0]}
                    </div>
                    المعلمة: {activity.educatorName}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ParentQueryState>
    </ParentShell>
  );
}
