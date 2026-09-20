import SectorView from "./SectorView";

export default async function SectorPage({ params }: PageProps<"/sector/[slug]">) {
  const { slug } = await params;
  return <SectorView key={slug} slug={slug} />;
}
