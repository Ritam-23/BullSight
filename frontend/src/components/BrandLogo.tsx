import Image from "next/image";

type BrandLogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
};

/** BullSight app logo from /public/logo.png */
export default function BrandLogo({ size = 64, className = "", priority = false }: BrandLogoProps) {
  return (
    <Image
      src="/logo.png"
      alt="BullSight"
      width={size}
      height={size}
      priority={priority}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
