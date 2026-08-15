import type { IntegrationProvider } from "@/lib/types";

// Neutral, hand-drawn marks in the lucide 24px stroke style. These are
// deliberately generic glyphs (hypervisor node, wireless rings, mesh,
// shield) rather than vendor trademarks.
function SvgBase({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label={title}
    >
      {children}
    </svg>
  );
}

function ProxmoxMark({
  className,
  title,
}: {
  className?: string;
  title: string;
}) {
  return (
    <SvgBase className={className} title={title}>
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" />
      <path d="M12 8 15.5 10v4L12 16l-3.5-2v-4L12 8Z" />
    </SvgBase>
  );
}

function UnifiMark({
  className,
  title,
}: {
  className?: string;
  title: string;
}) {
  return (
    <SvgBase className={className} title={title}>
      <circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none" />
      <path d="M7.75 13.2a6 6 0 0 1 8.5 0" />
      <path d="M4.9 10.1a10 10 0 0 1 14.2 0" />
    </SvgBase>
  );
}

function OmadaMark({
  className,
  title,
}: {
  className?: string;
  title: string;
}) {
  return (
    <SvgBase className={className} title={title}>
      <circle cx="12" cy="5.5" r="2" />
      <circle cx="5.5" cy="17.5" r="2" />
      <circle cx="18.5" cy="17.5" r="2" />
      <path d="M10.9 7.2 6.6 15.8M13.1 7.2l4.3 8.6M7.5 17.5h9" />
    </SvgBase>
  );
}

function OpnsenseMark({
  className,
  title,
}: {
  className?: string;
  title: string;
}) {
  return (
    <SvgBase className={className} title={title}>
      <path d="M12 2.8 19.5 6v6c0 4.4-3.2 7.7-7.5 9.2C7.7 19.7 4.5 16.4 4.5 12V6L12 2.8Z" />
      <path d="M8.5 12h7M12 8.5v7" />
    </SvgBase>
  );
}

export function IntegrationIcon({
  provider,
  className,
  title,
}: {
  provider: IntegrationProvider;
  className?: string;
  title?: string;
}) {
  const label = title ?? provider;
  if (provider === "proxmox") {
    return <ProxmoxMark className={className} title={label} />;
  }
  if (provider === "unifi") {
    return <UnifiMark className={className} title={label} />;
  }
  if (provider === "omada") {
    return <OmadaMark className={className} title={label} />;
  }
  return <OpnsenseMark className={className} title={label} />;
}
