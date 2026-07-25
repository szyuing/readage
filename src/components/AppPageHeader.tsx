import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { ReadAgeBrand } from './ReadAgeBrand';

interface AppPageHeaderProps {
  onBack: () => void;
  navigation: React.ReactNode;
  actions?: React.ReactNode;
}

export const AppPageHeader: React.FC<AppPageHeaderProps> = ({
  onBack,
  navigation,
  actions,
}) => (
  <header className="sticky top-0 z-20 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-[#E7E2D5] bg-[#F8F6F0]/90 px-3 py-2.5 backdrop-blur-md safe-pt sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-4 sm:py-3">
    <div className="flex min-w-11 items-center">
      <button
        type="button"
        onClick={onBack}
        className="tap-target inline-flex items-center justify-center rounded-xl p-2.5 text-[#524B43] transition-colors hover:bg-[#EFEAE0] active:bg-[#E8E2D5]"
        title="Back"
        aria-label="Back"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <ReadAgeBrand
        className="ml-2 hidden lg:inline-flex"
        logoClassName="h-7 w-7"
        nameClassName="text-base"
      />
    </div>

    <div className="flex min-w-0 justify-center px-1 sm:px-2">{navigation}</div>

    <div className="flex min-h-11 min-w-11 items-center justify-end">{actions}</div>
  </header>
);
