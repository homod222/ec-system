import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { useListBranches } from '@workspace/api-client-react';
import { useI18n } from '../i18n';
import { BranchTreeSelect } from './BranchTreeSelect';

export function branchIdPayload(value: string): number | null {
  return value ? Number(value) : null;
}

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
  const query = useListBranches(undefined, { request: { headers: { 'x-branch-id': '' } } });
  const initializedFromStoredBranch = useRef(false);

  const branches = (query.data ?? []).filter((branch) => branch.active || String(branch.id) === value);

  useEffect(() => {
    if (initializedFromStoredBranch.current || value || query.data === undefined) return;
    initializedFromStoredBranch.current = true;
    const storedBranchId = localStorage.getItem('ec.selectedBranchId');
    if (storedBranchId && branches.some((branch) => String(branch.id) === storedBranchId)) {
      onChange(storedBranchId);
    }
  }, [branches, onChange, query.data, value]);

  if (query.isLoading || query.isError) return null;
  if (branches.length <= 1) return null;

  return (
    <label className="text-sm font-bold text-foreground">
      {t('branch.label')}
      <div className="mt-2">
        <BranchTreeSelect
          mode="single"
          value={value}
          onChange={onChange}
          testId={testId}
          placeholder={t('branch.placeholder')}
        />
        {required && <input tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute h-0 w-0 opacity-0" required value={value} onChange={() => undefined} />}
      </div>
    </label>
  );
}
