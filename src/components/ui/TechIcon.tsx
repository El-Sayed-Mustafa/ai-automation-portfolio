import type { CSSProperties } from "react";
import { NODE_KIND_ICON } from "@/components/architecture/NodeDetails";
import type { ArchitectureNode, NodeKind, Tone } from "@/content/schema";
import { brandFor, nodeBrand, type Brand } from "./brand";

/** Each kind of component has its own colour, so a column of them is not one flat tint. */
export const KIND_TONE: Record<NodeKind, Tone> = {
  frontend: "blue",
  backend: "indigo",
  database: "violet",
  queue: "amber",
  worker: "teal",
  external: "rose",
  storage: "green",
  legacy: "slate",
  actor: "blue",
};

/** A technology's logo in its own colour, as a small mark beside its name. Decoration: the name is always written. */
export function BrandGlyph({ brand, size = 18, className = "" }: { brand: Brand; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={`shrink-0 fill-current text-(--brand-light) dark:text-(--brand-dark) ${className}`}
      style={{ "--brand-light": brand.light, "--brand-dark": brand.dark } as CSSProperties}
    >
      <path d={brand.path} />
    </svg>
  );
}

/**
 * The lit square that stands for a component. Built with something that has
 * a logo, it is that logo in white on the technology's own colour; otherwise
 * it is an icon for the kind of thing it is, on that kind's colour. Either
 * way it is a filled, glowing tile, so a diagram reads as a set of distinct
 * things and not as rows of grey boxes. `active` adds a ring, for the one
 * that is selected.
 */
export function NodeTile({
  node,
  size = 32,
  active = false,
  className = "",
}: {
  node: Pick<ArchitectureNode, "kind" | "label" | "technology">;
  /** Width and height of the square, in pixels. */
  size?: number;
  active?: boolean;
  className?: string;
}) {
  const brand = nodeBrand(node);
  const Icon = NODE_KIND_ICON[node.kind];
  const box: CSSProperties = { width: size, height: size, borderRadius: Math.round(size * 0.3) };
  const ring = active ? " lit-tile-active" : "";
  if (brand) {
    return (
      <span
        className={`lit-tile${ring} ${className}`}
        style={{ ...box, "--lit-light": brand.tileLight, "--lit-dark": brand.tileDark, "--lit-ink-light": brand.inkLight, "--lit-ink-dark": brand.inkDark } as CSSProperties}
        aria-hidden
      >
        <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" className="fill-current">
          <path d={brand.path} />
        </svg>
      </span>
    );
  }
  return (
    <span data-tone={KIND_TONE[node.kind]} className={`lit-tile lit-tile-tone${ring} ${className}`} style={box} aria-hidden>
      <Icon size={Math.round(size * 0.56)} strokeWidth={2.25} />
    </span>
  );
}

/** A technology's logo as a lit square, like a component's in a diagram. Nothing when the technology has no logo. */
export function TechTile({ name, size = 28 }: { name: string; size?: number }) {
  const brand = brandFor(name);
  if (!brand) return null;
  return (
    <span
      className="lit-tile"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), "--lit-light": brand.tileLight, "--lit-dark": brand.tileDark, "--lit-ink-light": brand.inkLight, "--lit-ink-dark": brand.inkDark } as CSSProperties}
      aria-hidden
    >
      <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" className="fill-current">
        <path d={brand.path} />
      </svg>
    </span>
  );
}

/**
 * What a workflow runs on, as a row of logos with their names. A technology
 * with no logo gets a dot, so the row never says less than the list. With
 * `compact`, only the logos are drawn, and the whole list is the row's name.
 */
export function TechRow({ names, compact = false, className = "" }: { names: readonly string[]; compact?: boolean; className?: string }) {
  if (compact) {
    const withLogo = names.filter((name) => brandFor(name));
    if (withLogo.length === 0) return null;
    return (
      <span className={`flex items-center gap-1.5 ${className}`} role="img" aria-label={`Built with ${names.join(", ")}`}>
        {withLogo.map((name) => (
          <span key={name} title={name} className="flex">
            <TechTile name={name} size={24} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <ul aria-label="Built with" className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 ${className}`}>
      {names.map((name) => (
        <li key={name} className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
          {brandFor(name) ? <TechTile name={name} size={26} /> : <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-line-strong" />}
          {name}
        </li>
      ))}
    </ul>
  );
}

/** The logo for a line of text that names a technology, or nothing. */
export function TechGlyph({ name, size = 14 }: { name: string; size?: number }) {
  const brand = brandFor(name);
  return brand ? <BrandGlyph brand={brand} size={size} /> : null;
}
