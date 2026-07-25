import React from 'react';
import { ArrowLeft } from 'lucide-react';

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
  <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#E7E2D5] bg-[#F8F6F0]/90 px-4 py-3 backdrop-blur-md">
    <button
      type="button"
      onClick={onBack}
      className="rounded-xl p-2 text-[#524B43] transition-colors hover:bg-[#EFEAE0]"
      title="Back"
      aria-label="Back"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>

    <div className="flex min-w-0 flex-1 justify-center px-2">{navigation}</div>

    <div className="flex min-h-9 min-w-9 items-center justify-end">{actions}</div>
  </header>
);
