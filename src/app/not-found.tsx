import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">This page does not exist</h1>
      <p className="mx-auto mt-3 max-w-md text-muted">The link may be out of date, or the project may have been renamed.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn btn-primary">
          Go to the home page
        </Link>
        <Link href="/projects" className="btn btn-secondary">
          See all projects
        </Link>
      </div>
    </div>
  );
}
