import type { SVGProps } from "react";

const base = {
  width: 14,
  height: 14,
  viewBox: "0 0 14 14",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} satisfies SVGProps<SVGSVGElement>;

export const FrameIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 1.5v11M11 1.5v11M1.5 3h11M1.5 11h11" />
  </svg>
);

export const SquareIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" />
  </svg>
);

export const HeadingIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 2.5v9M3 7h6M9 2.5v9" />
  </svg>
);

export const TextIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M2.5 3.5h9M7 3.5v8M5 11.5h4" />
  </svg>
);

export const ButtonIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="1.5" y="4" width="11" height="6" rx="3" />
    <path d="M5 7h4" />
  </svg>
);

export const ImageIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="2" y="2" width="10" height="10" rx="1.5" />
    <circle cx="5.5" cy="5.5" r="1" />
    <path d="M2 9.5l3-2 3 2.5 4-3" />
  </svg>
);

export const LinkIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6 8a2 2 0 0 0 2.83 0l2-2a2 2 0 1 0-2.83-2.83l-1 1" />
    <path d="M8 6a2 2 0 0 0-2.83 0l-2 2a2 2 0 1 0 2.83 2.83l1-1" />
  </svg>
);

export const ListIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M5 3.5h7M5 7h7M5 10.5h7M2.5 3.5h.01M2.5 7h.01M2.5 10.5h.01" />
  </svg>
);

export const InputIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="1.5" y="4" width="11" height="6" rx="1" />
    <path d="M3.5 6.5v1" />
  </svg>
);

export const SvgIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M2 7l5-5 5 5-5 5z" />
  </svg>
);

export const DotIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="7" cy="7" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const ChevronRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M5 3l4 4-4 4" />
  </svg>
);

export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 5l4 4 4-4" />
  </svg>
);

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M7 3v8M3 7h8" />
  </svg>
);

export const MinusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 7h8" />
  </svg>
);

export const FitIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9" />
  </svg>
);

export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M11.5 6a4.5 4.5 0 1 0-1.32 3.18M11.5 3v3h-3" />
  </svg>
);

export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 4h8M5.5 4V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M5 4l.5 7a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1L9 4" />
  </svg>
);

export const PlugIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M5 2v3M9 2v3M3 5h8v3a4 4 0 1 1-8 0V5zM7 12v1.5" />
  </svg>
);

export const ChevronExpandIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 5l3-3 3 3M4 9l3 3 3-3" />
  </svg>
);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT_TAGS = new Set(["p", "span", "label", "small", "strong", "em", "blockquote"]);
const LIST_TAGS = new Set(["ul", "ol", "li", "dl", "dt", "dd"]);
const INPUT_TAGS = new Set(["input", "textarea", "select", "form"]);
const BLOCK_TAGS = new Set([
  "div",
  "section",
  "main",
  "aside",
  "header",
  "footer",
  "nav",
  "article",
]);

export function iconForTag(tag: string) {
  if (tag === "artboard") return FrameIcon;
  if (HEADING_TAGS.has(tag)) return HeadingIcon;
  if (TEXT_TAGS.has(tag)) return TextIcon;
  if (tag === "button") return ButtonIcon;
  if (tag === "img" || tag === "picture") return ImageIcon;
  if (tag === "a") return LinkIcon;
  if (LIST_TAGS.has(tag)) return ListIcon;
  if (INPUT_TAGS.has(tag)) return InputIcon;
  if (tag === "svg" || tag === "path") return SvgIcon;
  if (BLOCK_TAGS.has(tag)) return SquareIcon;
  return DotIcon;
}
