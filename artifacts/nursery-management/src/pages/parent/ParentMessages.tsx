import { useState, useRef, useEffect } from 'react';
import { useListParentMessages, useListParentAnnouncements, useSendParentMessage, getListParentMessagesQueryKey, getGetParentOverviewQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ParentShell } from '../../components/ParentShell';
import { ParentPageHeader, ParentQueryState } from '../../components/ParentShared';
import { Send, Megaphone, MessageCircle } from 'lucide-react';

export function ParentMessages() {
  const [tab, setTab] = useState<'messages' | 'announcements'>('messages');
  
  return (
    <ParentShell>
      <ParentPageHeader 
        title="التواصل المباشر" 
        description="تواصل مع إدارة الحضانة والمعلمات، وتابع أحدث الإعلانات والتعاميم."
      />

      <div className="mb-8 flex rounded-2xl bg-white p-1 border border-[#165032]/10 w-fit shadow-sm">
        <button 
          data-testid="button-tab-messages"
          onClick={() => setTab('messages')}
          className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold transition-all ${
            tab === 'messages' ? 'bg-[#165032] text-white shadow-sm' : 'text-[#165032]/70 hover:text-[#165032]'
          }`}
        >
          <MessageCircle size={18} />
          المراسلات
        </button>
        <button 
          data-testid="button-tab-announcements"
          onClick={() => setTab('announcements')}
          className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold transition-all ${
            tab === 'announcements' ? 'bg-[#165032] text-white shadow-sm' : 'text-[#165032]/70 hover:text-[#165032]'
          }`}
        >
          <Megaphone size={18} />
          الإعلانات
        </button>
      </div>

      {tab === 'messages' ? <MessagesTab /> : <AnnouncementsTab />}
    </ParentShell>
  );
}

function MessagesTab() {
  const query = useListParentMessages();
  const messages = query.data || [];
  const send = useSendParentMessage();
  const qc = useQueryClient();
  
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !content.trim()) return;
    
    send.mutate({ data: { subject, content } }, {
      onSuccess: () => {
        setSubject('');
        setContent('');
        qc.invalidateQueries({ queryKey: getListParentMessagesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetParentOverviewQueryKey() });
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages.length]);

  return (
    <div className="flex h-[600px] flex-col overflow-hidden rounded-[2.5rem] bg-white border border-[#165032]/10 shadow-sm">
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-[#FDFBF7]/50 space-y-6">
        {query.isLoading ? (
          <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#165032]/20 border-t-[#165032]" /></div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageCircle size={48} className="mb-4 text-[#165032]/20" />
            <p className="font-bold text-[#165032]/60">لا توجد رسائل سابقة</p>
            <p className="text-sm text-[#165032]/40 mt-2">ابدأ محادثة جديدة مع إدارة الحضانة</p>
          </div>
        ) : (
          messages.slice().reverse().map((msg) => {
            const isMe = msg.senderType === 'parent';
            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl p-5 ${
                  isMe 
                    ? 'bg-[#165032] text-white rounded-bl-sm' 
                    : 'bg-white border border-[#165032]/10 text-[#0f2416] rounded-br-sm shadow-sm'
                }`}>
                  <p className={`text-xs font-bold mb-2 ${isMe ? 'text-white/70' : 'text-[#165032]/60'}`}>
                    {msg.subject}
                  </p>
                  <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
                <p className="text-[10px] font-bold text-[#165032]/40 mt-2 px-2">
                  {new Date(msg.createdAt).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                </p>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      
      <div className="bg-white p-5 border-t border-[#165032]/10">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input 
            data-testid="input-message-subject"
            value={subject} 
            onChange={e => setSubject(e.target.value)} 
            placeholder="موضوع الرسالة" 
            className="w-full rounded-xl border border-[#165032]/10 bg-[#FDFBF7] px-4 py-3 text-sm font-bold outline-none focus:border-[#165032] focus:ring-2 focus:ring-[#165032]/10 transition-all"
            required
            maxLength={160}
          />
          <div className="flex items-end gap-3">
            <textarea 
              data-testid="input-message-content"
              value={content} 
              onChange={e => setContent(e.target.value)} 
              placeholder="اكتب رسالتك هنا..." 
              className="w-full resize-none rounded-xl border border-[#165032]/10 bg-[#FDFBF7] px-4 py-3 text-sm font-medium outline-none focus:border-[#165032] focus:ring-2 focus:ring-[#165032]/10 transition-all min-h-[50px] max-h-32"
              rows={2}
              required
              maxLength={5000}
            />
            <button 
              data-testid="button-send-message"
              type="submit" 
              disabled={send.isPending || !subject.trim() || !content.trim()}
              className="shrink-0 flex h-[50px] w-[50px] items-center justify-center rounded-xl bg-[#165032] text-white hover:bg-[#165032]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <Send size={20} className="rtl:rotate-180" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AnnouncementsTab() {
  const query = useListParentAnnouncements();
  const announcements = query.data || [];

  return (
    <ParentQueryState loading={query.isLoading} error={query.isError} empty={!announcements.length} onRetry={() => query.refetch()}>
      <div className="grid gap-6 md:grid-cols-2">
        {announcements.map((item) => (
          <div key={item.id} data-testid={`card-announcement-${item.id}`} className="rounded-[2rem] bg-white p-8 shadow-sm border border-[#165032]/5 hover:shadow-md transition-shadow">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-600">
                <Megaphone size={20} />
              </div>
              <span className="text-xs font-bold text-[#165032]/50 bg-[#FDFBF7] px-3 py-1.5 rounded-full border border-[#165032]/5">
                {new Date(item.publishedAt).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
            <h3 className="text-xl font-bold text-[#0f2416] mb-3">{item.title}</h3>
            <p className="text-sm font-medium leading-relaxed text-[#165032]/80 whitespace-pre-wrap">
              {item.content}
            </p>
          </div>
        ))}
      </div>
    </ParentQueryState>
  );
}
