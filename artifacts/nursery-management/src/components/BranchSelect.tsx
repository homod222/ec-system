import type { JSX } from 'react';
import { useListBranches } from '@workspace/api-client-react';
import { useI18n } from '../i18n';

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
  const query = useListBranches();

  if (query.isLoading || query.isError) return null;
  const branches = (query.data ?? []).filter((branch) => branch.active || String(branch.id) === value);
  if (branches.length <= 1) return null;

  return (
    <label className="text-sm font-bold text-foreground">
      {t('branch.label')}
      <select
        data-testid={testId}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        <option value="">{t('branch.placeholder')}</option>
        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>
    </label>
  );
}
