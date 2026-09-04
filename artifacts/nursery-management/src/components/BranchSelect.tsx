import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { getGetSessionContextQueryKey, useGetSessionContext } from '@workspace/api-client-react';
import { useI18n } from '../i18n';

export function branchIdPayload(value: string): number | null {
  return value ? Number(value) : null;
}

const selectClassName = 'mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70';

export function BranchSelect({
  value,
  onChange,
  testId,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  required?: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const sessionQuery = useGetSessionContext({
    query: { queryKey: getGetSessionContextQueryKey(), retry: false },
  });
  const [pendingOrganizationId, setPendingOrganizationId] = useState('');
  const initializedFromStoredBranch = useRef(false);

  const branches = (sessionQuery.data?.branchScope.branches ?? []).filter((branch) => branch.active || String(branch.id) === value);
  const organizations = (sessionQuery.data?.branchScope.organizations ?? []).filter((organization) =>
    branches.some((branch) => branch.organizationId === organization.id),
  );
  const selectedBranch = branches.find((branch) => String(branch.id) === value);
  const organizationId = selectedBranch
    ? String(selectedBranch.organizationId)
    : organizations.length === 1 ? String(organizations[0].id) : pendingOrganizationId;
  const organizationBranches = branches.filter((branch) => String(branch.organizationId) === organizationId);

  useEffect(() => {
    if (value || sessionQuery.data === undefined) return;
    if (branches.length === 1) {
      onChange(String(branches[0].id));
      return;
    }
    if (organizationId && organizationBranches.length === 1) {
      onChange(String(organizationBranches[0].id));
      return;
    }
    if (initializedFromStoredBranch.current) return;
    initializedFromStoredBranch.current = true;
    const storedBranchId = localStorage.getItem('ec.selectedBranchId');
    const storedBranchIds = storedBranchId?.split(',').filter(Boolean) || [];
    if (storedBranchIds.length === 1 && branches.some((branch) => String(branch.id) === storedBranchIds[0])) {
      onChange(storedBranchIds[0]);
    }
  }, [branches, onChange, organizationBranches, organizationId, sessionQuery.data, value]);

  if (sessionQuery.isLoading || sessionQuery.isError) return null;
  if (branches.length === 0) return null;

  return (
    <>
      <label className="text-sm font-bold text-foreground">
        {t('branch.organizationLabel')}
        <select
          data-testid={`${testId}-organization`}
          value={organizationId}
          disabled={organizations.length <= 1}
          onChange={(event) => { setPendingOrganizationId(event.target.value); onChange(''); }}
          className={selectClassName}
        >
          <option value="">{t('branch.organizationPlaceholder')}</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>{organization.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-bold text-foreground">
        {t('branch.label')}
        <select
          data-testid={testId}
          value={value}
          required={required}
          disabled={!organizationId || organizationBranches.length <= 1}
          onChange={(event) => onChange(event.target.value)}
          className={selectClassName}
        >
          <option value="">{t('branch.placeholder')}</option>
          {organizationBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.name}</option>
          ))}
        </select>
      </label>
    </>
  );
}
