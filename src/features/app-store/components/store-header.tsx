'use client';

import { useTranslation } from 'react-i18next';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/utils/cn';
import { nammuCategoryPath, getNammuNavCategories, getNammuCategoryLabel, NAMMU_DISCOVER_PATH } from '@/lib/appStore';
import { useAvailableApps } from '@/features/app-store/providers/available-apps';
import { useStorefront } from '@/features/app-store/providers/storefront';
import { useStoreSearch } from '@/features/app-store/hooks/use-store-search';
import { SearchInput } from './search-input';

interface StoreHeaderProps {
  search: ReturnType<typeof useStoreSearch>;
  isOwner: boolean;
}

export function StoreHeader({ search, isOwner }: StoreHeaderProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { appsGroupedByCategory } = useAvailableApps();
  const storefront = useStorefront();

  const navCategories = getNammuNavCategories(appsGroupedByCategory ?? {});
  const isDiscover = pathname === NAMMU_DISCOVER_PATH;
  const isAll = pathname === nammuCategoryPath('all');
  const isCategory = pathname?.startsWith('/app-store/category/');

  return (
    <header className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
      <div className='flex flex-col gap-2 md:flex-row md:items-center md:gap-4'>
        <h1 className='text-2xl font-semibold md:text-3xl'>{t('app-store.title')}</h1>
        <SearchInput search={search} />
      </div>
      <nav className='flex flex-wrap gap-1' aria-label={t('app-store.navigation')}>
        <CategoryNavItem
          id="discover"
          label={t('app-store.category.discover')}
          href={NAMMU_DISCOVER_PATH}
          active={isDiscover}
          disabled={storefront.isUnavailable}
        />
        <CategoryNavItem
          id="all"
          label={t('app-store.category.all')}
          href={nammuCategoryPath('all')}
          active={isAll}
        />
        {navCategories
          .filter((cat) => cat !== 'discover' && cat !== 'all')
          .map((catId) => (
            <CategoryNavItem
              key={catId}
              id={catId}
              label={getNammuCategoryLabel(catId, t)}
              href={nammuCategoryPath(catId)}
              active={isCategory && pathname === nammuCategoryPath(catId)}
            />
          ))}
      </nav>
    </header>
  );
}

function CategoryNavItem({
  id,
  label,
  href,
  active,
  disabled,
}: {
  id: string;
  label: string;
  href: string;
  active: boolean;
  disabled?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4aa3ff]/50',
        active
          ? 'bg-[#4aa3ff]/20 border border-[#4aa3ff]/30 text-[#4aa3ff]'
          : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20',
        disabled && 'opacity-40 pointer-events-none',
      )}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </Link>
  );
}