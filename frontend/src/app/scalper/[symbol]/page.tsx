import ScalperView from "./ScalperView";

export default async function ScalperPage({ params }: PageProps<"/scalper/[symbol]">) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  return <ScalperView key={sym} symbol={sym} />;
}
