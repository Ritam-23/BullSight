import Loader from "@/components/Loader";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-1 animate-fade-in items-center justify-center">
      <Loader size="lg" label="Loading…" />
    </div>
  );
}
