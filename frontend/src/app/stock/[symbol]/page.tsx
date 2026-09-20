import StockView from "./StockView";

export default async function StockPage({ params }: PageProps<"/stock/[symbol]">) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  return <StockView key={sym} symbol={sym} />;
}
