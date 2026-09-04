import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, ChevronDown, ChevronRight, ChevronsUpDown, Search, X } from 'lucide-react';
import {
  getGetSessionContextQueryKey,
  useGetSessionContext,
  type SessionContextBranchScopeBranchesItem,
  type SessionContextBranchScopeOrganizationsItem,
} from '@workspace/api-client-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '@/lib/utils';
import { useI18n } from '../i18n';

export type BranchTreeSelectSource = {
  organizations: SessionContextBranchScopeOrganizationsItem[];
  branches: SessionContextBranchScopeBranchesItem[];
};

type SingleProps = {
  mode: 'single';
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
  allLabel?: string;
  testId: string;
  placeholder?: string;
  hideAll?: boolean;
  source?: BranchTreeSelectSource;
  compact?: boolean;
  disabled?: boolean;
};

type MultiValue = {
  organizationIds: number[];
  branchIds: number[];
};

type MultiProps = {
  mode: 'multi';
  value: MultiValue;
  onChange: (value: MultiValue) => void;
  testId: string;
  allowAll?: boolean;
  allLabel?: string;
  source?: BranchTreeSelectSource;
  compact?: boolean;
  disabled?: boolean;
};

export type BranchTreeSelectProps = SingleProps | MultiProps;

export function BranchTreeSelect(props: BranchTreeSelectProps) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsedOrganizations, setCollapsedOrganizations] = useState<Set<number>>(new Set());
  const sessionQuery = useGetSessionContext({
    query: {
      enabled: !props.source,
      queryKey: getGetSessionContextQueryKey(),
      retry: false,
    },
  });

  const organizations = props.source?.organizations || sessionQuery.data?.branchScope.organizations || [];
  const allBranches = props.source?.branches || sessionQuery.data?.branchScope.branches || [];
  const selectedBranchIds = props.mode === 'single'
    ? (props.value ? [Number(props.value)] : [])
    : props.value.branchIds;
  const selectedOrganizationIds = props.mode === 'multi' ? props.value.organizationIds : [];

  const branches = useMemo(
    () => allBranches.filter((branch) => branch.active !== false || selectedBranchIds.includes(branch.id)),
    [allBranches, selectedBranchIds],
  );

  const branchesByOrganization = useMemo(() => {
    const grouped = new Map<number, SessionContextBranchScopeBranchesItem[]>();
    branches.forEach((branch) => {
      const current = grouped.get(branch.organizationId) || [];
      current.push(branch);
      grouped.set(branch.organizationId, current);
    });
    return grouped;
  }, [branches]);

  const visibleTree = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return organizations.flatMap((organization) => {
      const organizationBranches = branchesByOrganization.get(organization.id) || [];
      const organizationMatches = !query
        || organization.name.toLocaleLowerCase().includes(query);
      const matchingBranches = organizationBranches.filter((branch) => (
        !query
        || branch.name.toLocaleLowerCase().includes(query)
        || selectedBranchIds.includes(branch.id)
      ));
      if (!organizationBranches.length && !selectedOrganizationIds.includes(organization.id)) return [];
      if (!organizationMatches && !matchingBranches.length) return [];
      return [{
        organization,
        branches: organizationMatches || !query ? organizationBranches : matchingBranches,
      }];
    });
  }, [branchesByOrganization, organizations, search, selectedBranchIds, selectedOrganizationIds]);

  const selectedBranch = props.mode === 'single'
    ? branches.find((branch) => String(branch.id) === props.value)
    : undefined;

  const selectedLabels = props.mode === 'multi'
    ? [
      ...organizations
        .filter((organization) => props.value.organizationIds.includes(organization.id))
        .map((organization) => ({ key: `organization-${organization.id}`, label: organization.name })),
      ...branches
        .filter((branch) => props.value.branchIds.includes(branch.id) && !props.value.organizationIds.includes(branch.organizationId))
        .map((branch) => ({ key: `branch-${branch.id}`, label: branch.name })),
    ]
    : [];

  const toggleOrganization = (organizationId: number) => {
    if (props.mode !== 'multi') return;
    const selected = props.value.organizationIds.includes(organizationId);
    props.onChange({
      organizationIds: selected
        ? props.value.organizationIds.filter((id) => id !== organizationId)
        : [...props.value.organizationIds, organizationId],
      branchIds: selected
        ? props.value.branchIds
        : props.value.branchIds.filter((branchId) => (
          !branches.some((branch) => branch.id === branchId && branch.organizationId === organizationId)
        )),
    });
  };

  const toggleBranch = (branchId: number) => {
    if (props.mode !== 'multi') return;
    const branch = branches.find((item) => item.id === branchId);
    if (!branch || props.value.organizationIds.includes(branch.organizationId)) return;
    props.onChange({
      ...props.value,
      branchIds: props.value.branchIds.includes(branchId)
        ? props.value.branchIds.filter((id) => id !== branchId)
        : [...props.value.branchIds, branchId],
    });
  };

  const toggleCollapsed = (organizationId: number) => {
    setCollapsedOrganizations((current) => {
      const next = new Set(current);
      if (next.has(organizationId)) next.delete(organizationId);
      else next.add(organizationId);
      return next;
    });
  };

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const clearSelection = () => {
    if (props.mode === 'single') props.onChange('');
    else props.onChange({ organizationIds: [], branchIds: [] });
    setOpen(false);
  };

  const triggerLabel = props.mode === 'single'
    ? selectedBranch
      ? selectedBranch.name
      : props.allowAll && !props.value
        ? props.allLabel || t('branchTree.allBranches')
        : props.placeholder || t('branchTree.selectBranch')
    : selectedLabels.length
      ? selectedLabels.length > (props.compact ? 2 : 3)
        ? t('branchTree.selected', { count: selectedLabels.length })
        : props.compact
          ? selectedLabels.map(({ label }) => label).join(t('branchTree.listSeparator'))
          : selectedLabels.map(({ key, label }) => (
            <Badge key={key} variant="secondary">{label}</Badge>
          ))
      : props.allowAll ? props.allLabel || t('branchTree.allBranches') : t('branchTree.selectBranch');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-testid={props.testId}
          disabled={props.disabled}
          variant="outline"
          className={cn(
            'w-full justify-between border-border bg-card text-foreground hover:bg-muted',
            props.compact ? 'h-8 rounded-full px-3 py-1.5 text-xs' : 'min-h-10',
          )}
        >
          <span className={cn(
            'flex min-w-0 items-center gap-1.5 text-start',
            props.mode === 'single' && 'truncate',
            !selectedBranch && props.mode === 'single' && 'text-muted-foreground',
          )}>
            {triggerLabel}
          </span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        dir={dir}
        align={dir === 'rtl' ? 'end' : 'start'}
        className="w-[min(24rem,calc(100vw-2rem))] border-border bg-card p-0 text-foreground"
      >
        <div dir={dir}>
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground" />
              <Input
                data-testid={`${props.testId}-search`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('branchTree.search')}
                className="ps-9 pe-3"
              />
            </div>
          </div>

          {props.allowAll && !(props.mode === 'single' && props.hideAll) && (
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 border-b border-border px-4 py-3 text-start text-sm font-medium transition-colors hover:bg-muted',
                (props.mode === 'single' ? !props.value : !selectedLabels.length) && 'bg-primary/10 text-primary',
              )}
              onClick={clearSelection}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {(props.mode === 'single' ? !props.value : !selectedLabels.length) && <Check className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{props.allLabel || t('branchTree.allBranches')}</span>
            </button>
          )}

          <ScrollArea className="max-h-80" dir={dir}>
            <div className="space-y-1 p-2">
              {visibleTree.length ? visibleTree.map(({ organization, branches: organizationBranches }) => {
                const organizationSelected = props.mode === 'multi'
                  && props.value.organizationIds.includes(organization.id);
                const expanded = search.trim() !== '' || !collapsedOrganizations.has(organization.id);
                return (
                  <div key={organization.id} className="rounded-lg">
                    <div className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-2 text-primary hover:bg-primary/15">
                      {props.mode === 'multi' ? (
                        <Checkbox
                          data-testid={`${props.testId}-org-${organization.id}`}
                          checked={organizationSelected}
                          onCheckedChange={() => toggleOrganization(organization.id)}
                          aria-label={organization.name}
                        />
                      ) : (
                        <span className="h-4 w-4 shrink-0" />
                      )}
                      <button
                        type="button"
                        className={cn('flex min-w-0 flex-1 items-center gap-2 text-start')}
                        onClick={() => toggleCollapsed(organization.id)}
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-primary rtl:order-last" />
                        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground rtl:order-last" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:order-last rtl:rotate-180" />}
                        <span className="min-w-0 flex-1 truncate text-sm font-bold">{organization.name}</span>
                      </button>
                    </div>
                    {expanded && (
                      <div className="space-y-1">
                        {organizationBranches.map((branch) => {
                          const branchSelected = selectedBranchIds.includes(branch.id);
                          const disabled = props.mode === 'multi' && organizationSelected;
                          if (props.mode === 'single') {
                            return (
                              <button
                                key={branch.id}
                                type="button"
                                data-testid={`${props.testId}-branch-${branch.id}`}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-lg py-2 text-start text-sm transition-colors hover:bg-muted',
                                  'pe-2 ps-10',
                                  branchSelected && 'bg-primary/10 font-bold text-primary',
                                )}
                                onClick={() => {
                                  props.onChange(String(branch.id));
                                  setOpen(false);
                                }}
                              >
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                  {branchSelected && <Check className="h-4 w-4" />}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                              </button>
                            );
                          }
                          return (
                            <label
                              key={branch.id}
                              className={cn(
                                'flex items-center gap-2 rounded-lg py-2 text-sm transition-colors hover:bg-muted',
                                'pe-2 ps-10',
                                disabled && 'opacity-70',
                              )}
                            >
                              <Checkbox
                                data-testid={`${props.testId}-branch-${branch.id}`}
                                checked={branchSelected || disabled}
                                disabled={disabled}
                                onCheckedChange={() => toggleBranch(branch.id)}
                                aria-label={branch.name}
                              />
                              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }) : (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('branchTree.noResults')}</p>
              )}
            </div>
          </ScrollArea>

          {props.mode === 'multi' && (
            <div className="space-y-3 border-t border-border p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                <span>{t('branchTree.organizationsCount', { count: props.value.organizationIds.length })}</span>
                <span>{t('branchTree.branchesCount', { count: props.value.branchIds.length })}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => props.onChange({ organizationIds: [], branchIds: [] })}
              >
                <X className="h-4 w-4" />{t('branchTree.clearAll')}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
