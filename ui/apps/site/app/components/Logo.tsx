import Image from 'next/image';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 font-bold ${className}`}>
      <Image 
        src="/logo.svg" 
        alt="Object UI Logo" 
        width={32} 
        height={32} 
        className="h-8 w-8"
      />
      <span>Object UI</span>
    </div>
  );
}
