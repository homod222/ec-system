import { useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListSiteGalleryQueryKey,
  useAttachSiteGalleryItem,
  useDeleteSiteGalleryItem,
  useListSiteGallery,
  useRequestSiteGalleryUploadUrl,
  useUpdateSiteGalleryItem,
  useGetSessionContext,
  type SiteGalleryItem,
} from '@workspace/api-client-react';
import { Button, PageHeader, QueryState, Shell } from '../../App';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '../../i18n';

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

function GalleryCard({ item, refresh, permissions }: {
  item: SiteGalleryItem;
  refresh: () => void;
  permissions: string[];
}) {
  const update = useUpdateSiteGalleryItem();
  const remove = useDeleteSiteGalleryItem();
  const [title, setTitle] = useState(item.title);
  const [altText, setAltText] = useState(item.altText);
  const [sortOrder, setSortOrder] = useState(item.sortOrder);
  const saveTitle = () => title.trim() !== item.title && update.mutate({ id: item.id, data: { title: title.trim() } }, { onSuccess: refresh });
  const saveAltText = () => altText.trim() !== item.altText && update.mutate({ id: item.id, data: { altText: altText.trim() } }, { onSuccess: refresh });
  const saveOrder = () => sortOrder !== item.sortOrder && update.mutate({ id: item.id, data: { sortOrder } }, { onSuccess: refresh });
  const canUpdate = permissions.includes('update:site-gallery');
  const canReorder = permissions.includes('reorder:site-gallery');
  const canPublish = permissions.includes('publish:site-gallery');
  const canDelete = permissions.includes('delete:site-gallery');
  const { t } = useI18n();
  return <article className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
    <img src={`/api/site-gallery/${item.id}/image`} alt={item.altText} className="aspect-[4/3] w-full object-cover" />
    <div className="space-y-4 p-5">
      <input disabled={!canUpdate} value={title} aria-label={t('gallery.titleLabel')} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} className="w-full rounded-lg border border-input px-3 py-2 font-bold disabled:opacity-60" />
      <input disabled={!canUpdate} value={altText} aria-label={t('gallery.altLabel')} onChange={(e) => setAltText(e.target.value)} onBlur={saveAltText} className="w-full rounded-lg border border-input px-3 py-2 text-sm disabled:opacity-60" />
      <div className="flex gap-2">
        <input disabled={!canReorder} type="number" value={sortOrder} aria-label={t('gallery.orderLabel')} onChange={(e) => setSortOrder(Number(e.target.value))} onBlur={saveOrder} className="w-20 rounded-lg border border-input px-3 py-2 disabled:opacity-60" />
        <select disabled={!canPublish} value={item.status} onChange={(e) => update.mutate({ id: item.id, data: { status: e.target.value as 'draft' | 'published' | 'hidden' } }, { onSuccess: refresh })} className="flex-1 rounded-lg border border-input px-3 py-2 disabled:opacity-60">
          <option value="draft">{t('gallery.draft')}</option><option value="published">{t('gallery.published')}</option><option value="hidden">{t('gallery.hidden')}</option>
        </select>
        {canDelete && <Button variant="danger" aria-label={t('gallery.delete')} disabled={remove.isPending} onClick={() => {
          if (window.confirm(t('gallery.deleteConfirm'))) remove.mutate({ id: item.id }, { onSuccess: refresh });
        }}><Trash2 size={16} /></Button>}
      </div>
    </div>
  </article>;
}

export function SiteGallery() {
  const { t } = useI18n();
  const session = useGetSessionContext();
  const effective = session.data?.effectivePermissions || [];
  const canRead = effective.includes('read:site-gallery');
  const canCreate = effective.includes('create:site-gallery');
  const query = useListSiteGallery({ query: { queryKey: getListSiteGalleryQueryKey(), enabled: canRead } });
  const requestUpload = useRequestSiteGalleryUploadUrl();
  const attach = useAttachSiteGalleryItem();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [altText, setAltText] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: getListSiteGalleryQueryKey() });
  const selectFile = (selected?: File) => {
    if (!selected) return;
    if (!allowedTypes.includes(selected.type) || selected.size > 10 * 1024 * 1024) {
      toast({ title: t('gallery.fileError'), variant: 'destructive' });
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    if (!altText) setAltText(selected.name.replace(/\.[^.]+$/, ''));
  };
  const upload = async () => {
    if (!file || !title.trim() || !altText.trim()) return;
    try {
      const grant = await requestUpload.mutateAsync({ data: {
        name: file.name, size: file.size, contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      } });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', grant.uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.upload.onprogress = (event) => event.lengthComputable && setProgress(Math.round(event.loaded * 100 / event.total));
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(t('gallery.uploadError')));
        xhr.onerror = () => reject(new Error(t('gallery.uploadError')));
        xhr.send(file);
      });
      await attach.mutateAsync({ data: {
        title: title.trim(), altText: altText.trim(), objectPath: grant.objectPath,
        contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        size: file.size, sortOrder,
      } });
      setFile(null); setTitle(''); setAltText(''); setSortOrder(0); setProgress(0);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      await refresh();
      toast({ title: t('gallery.uploaded') });
    } catch {
      toast({ title: t('gallery.uploadCompleteError'), variant: 'destructive' });
    }
  };

  if (!session.isLoading && !canRead) return <Shell><PageHeader eyebrow={t('gallery.eyebrow')} title={t('gallery.title')} /><div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 font-bold text-destructive">{t('gallery.noAccess')}</div></Shell>;
  return <Shell>
    <PageHeader eyebrow={t('gallery.eyebrow')} title={t('gallery.title')} description={t('gallery.description')} />
    {canCreate && <section className="mb-8 grid gap-5 rounded-[1.5rem] border border-border bg-card p-6 shadow-sm md:grid-cols-[180px_1fr]">
      <label className="grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5">
        {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <span className="text-center text-sm font-bold text-primary"><ImagePlus className="mx-auto mb-2" />{t('gallery.chooseImage')}</span>}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => selectFile(e.target.files?.[0])} />
      </label>
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold">{t('gallery.titleLabel')}<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" /></label>
        <label className="text-sm font-bold">{t('gallery.altLabel')}<input value={altText} onChange={(e) => setAltText(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" /></label>
        <label className="text-sm font-bold">{t('gallery.orderLabel')}<input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3" /></label>
        <div className="flex items-end"><Button disabled={!file || !title.trim() || !altText.trim() || requestUpload.isPending || attach.isPending} onClick={upload}><Upload size={17} />{t('gallery.uploadAdd')}</Button></div>
        {progress > 0 && <div className="sm:col-span-2"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{t('gallery.progress', { progress })}</p></div>}
      </div>
    </section>}
    <QueryState loading={query.isLoading} error={query.isError} empty={!query.data?.length} onRetry={() => query.refetch()}>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {(query.data || []).map((item) => <GalleryCard key={item.id} item={item} refresh={refresh} permissions={effective} />)}
      </div>
    </QueryState>
  </Shell>;
}